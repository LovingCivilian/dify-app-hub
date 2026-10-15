import * as z from 'zod'

/*
 * The hub's own `ask_user` tool (Part 2 spec §6.2; decision 46): the full-stack template's tool
 * (`backend/app/agents/tools/ask_user_tool.py`, release 0.2.21), which the hub advertises as an AG-UI frontend tool while
 * the app's `askUser` is on. Client-safe (zod only): the browser reads a call's arguments and writes the transcript the
 * server stores (2b's plan calls P2, P3), the server checks the same arguments, and lib/chat/hub-tools.ts (server-only)
 * advertises the definition built from the schema below.
 */

/** The template's tool name. */
export const ASK_USER_TOOL_NAME = 'ask_user'
/** P2: the template's MAX_QUESTIONS. */
export const ASK_USER_MAX_QUESTIONS = 10
/** P2: the hub's bounds on a question and its options (spec §6.2: the arguments are untrusted; the template has none). */
export const ASK_USER_QUESTION_MAX = 500
export const ASK_USER_MAX_OPTIONS = 10
export const ASK_USER_OPTION_MAX = 200
/** P3: one free answer in the card. */
export const ASK_USER_ANSWER_MAX = 2_000

/**
 * P2: the arguments, the template's `questions: list[QuestionItem]` with the hub's limits. zod 4.6.5 measures a string's
 * length in code points (`$ZodCheckMaxLength`), as JSON Schema's `maxLength` does, so the advertised schema and this one
 * agree; unknown keys are dropped (zod 4 "Objects"). The descriptions are the template's (`QuestionItem`'s fields and the
 * tool docstring's `Args`), carried into the advertised JSON Schema by `.meta()` (zod 4 "JSON Schema": metadata), as
 * Pydantic carries the template's `Field(description=…)` into its tool schema.
 */
export const askUserArgsSchema = z.object({
	questions: z
		.array(
			z
				.object({
					question: z
						.string()
						.trim()
						.min(1)
						.max(ASK_USER_QUESTION_MAX)
						.meta({ description: 'The question text.' }),
					options: z
						.array(z.string().trim().min(1).max(ASK_USER_OPTION_MAX))
						.max(ASK_USER_MAX_OPTIONS)
						.default([])
						.meta({ description: 'Optional suggested answers, shown as numbered choices.' }),
					allow_custom: z.boolean().default(true).meta({
						description:
							'Whether the user may type a free-form answer instead of picking an option.',
					}),
				})
				.meta({ description: 'One question to put to the user.' }),
		)
		.min(1)
		.max(ASK_USER_MAX_QUESTIONS)
		.meta({
			description:
				'The questions to ask. Each has the question text, optional suggested `options`, and `allow_custom` (whether a free-form answer is allowed, default true).',
		}),
})

export type AskUserArgs = z.output<typeof askUserArgsSchema>
export type AskUserQuestion = AskUserArgs['questions'][number]

/**
 * A call's streamed arguments (JSON text) read with the schema; null when they are not JSON or do not match it (spec
 * §6.2: the arguments are untrusted; AG-UI 1.0 "Tool Calls": the arguments arrive as streamed JSON text).
 */
export const parseAskUserArgs = (args: string): AskUserArgs | null => {
	let value: unknown
	try {
		value = JSON.parse(args)
	} catch {
		return null
	}
	const parsed = askUserArgsSchema.safeParse(value)
	return parsed.success ? parsed.data : null
}

/** The user's answer to one question in the card: a picked option or a free answer, or Skip. */
export interface AskUserAnswer {
	answer: string
	skipped: boolean
}

/** P3: the template's markers for a skipped question and a blank answer. */
export const SKIPPED_ANSWER = '(skipped)'
export const NO_ANSWER = '(no answer)'

/**
 * P3: the template's `format_answers`, the `tool` message's content: "Q: <question>\nA: <answer>" per question, joined
 * by a blank line; a skipped question reads "(skipped)", a blank answer "(no answer)". A question without an answer
 * counts as not skipped and blank, as the template's `answers[i] if i < len(answers) else {}` does.
 */
export const askUserTranscript = (
	questions: readonly AskUserQuestion[],
	answers: readonly AskUserAnswer[],
): string =>
	questions
		.map((question, index) => {
			const answer: AskUserAnswer | undefined = answers[index]
			const text = answer?.skipped ? SKIPPED_ANSWER : answer?.answer.trim() || NO_ANSWER
			return `Q: ${question.question}\nA: ${text}`
		})
		.join('\n\n')

/**
 * The answers a transcript of these questions holds (askUserTranscript read back), or null for any other text, such as
 * an agent's own tool of the same name. Each question's "Q: …\nA: " opens its answer, which runs to the next question's
 * opening, or to the end for the last; "(skipped)" reads as skipped and "(no answer)" as blank. The card's free answer
 * is one line (an `<input>`), so an answer with a line break that is not one of its question's options is not the
 * card's, and the answers read back must write the same text again.
 */
export const askUserAnswersOf = (
	questions: readonly AskUserQuestion[],
	transcript: string,
): AskUserAnswer[] | null => {
	const opening = (index: number) =>
		`${index === 0 ? '' : '\n\n'}Q: ${questions[index].question}\nA: `
	const answers: AskUserAnswer[] = []
	let position = 0
	for (let index = 0; index < questions.length; index++) {
		if (!transcript.startsWith(opening(index), position)) return null
		const start = position + opening(index).length
		const end =
			index + 1 < questions.length
				? transcript.indexOf(opening(index + 1), start)
				: transcript.length
		if (end < 0) return null
		const text = transcript.slice(start, end)
		if (text.includes('\n') && !questions[index].options.includes(text)) return null
		answers.push(
			text === SKIPPED_ANSWER
				? { answer: '', skipped: true }
				: { answer: text === NO_ANSWER ? '' : text, skipped: false },
		)
		position = end
	}
	return questions.length > 0 && askUserTranscript(questions, answers) === transcript
		? answers
		: null
}
