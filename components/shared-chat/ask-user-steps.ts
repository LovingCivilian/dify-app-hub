import {
	askUserTranscript,
	parseAskUserArgs,
	type AskUserAnswer,
	type AskUserQuestion,
} from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'

import type { ToolAnswer } from './provider/ag-ui-chat-provider'

/*
 * The ask_user card's steps (spec §6.2; plan calls P3, P4), pure so the unit suite covers them: the card
 * (ask-user-card.tsx) only renders the current step and records what the user did. The UX is the full-stack template's
 * `QuestionPrompt` (`frontend/src/components/ui/question-prompt.tsx`): one question at a time, digit keys pick an
 * option, Skip answers one question, Dismiss skips the rest.
 */

/** One question on the card, with the call it belongs to. */
export interface QuestionStep {
	toolCallId: string
	/** null: the call's arguments are invalid (P3); the step offers Dismiss only. */
	question: AskUserQuestion | null
}

/** Plan call P4: every open call's questions in call order, one card; a call with invalid arguments is one step. */
export const questionSteps = (calls: readonly ToolPart[]): QuestionStep[] =>
	calls.flatMap<QuestionStep>(call => {
		const args = parseAskUserArgs(call.args)
		return args
			? args.questions.map(question => ({ toolCallId: call.toolCallId, question }))
			: [{ toolCallId: call.toolCallId, question: null }]
	})

/**
 * The calls whose every step has an answer, as tool answers (askUserTranscript; '' for an invalid call), in call order.
 * `answers` holds one answer per step from the first, so the finished calls are always the first ones.
 */
export const finishedCalls = (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
): ToolAnswer[] => {
	const finished: ToolAnswer[] = []
	let start = 0
	for (const call of calls) {
		const args = parseAskUserArgs(call.args)
		const end = start + (args ? args.questions.length : 1)
		if (answers.length < end) break
		finished.push({
			toolCallId: call.toolCallId,
			// Plan call P3: the server answers an invalid call with its own error message, whatever the browser sends.
			content: args ? askUserTranscript(args.questions, answers.slice(start, end)) : '',
		})
		start = end
	}
	return finished
}

/** Skip, and every step Dismiss passes over (the template's `{ answer: "", skipped: true }`). */
export const SKIPPED: AskUserAnswer = { answer: '', skipped: true }

/**
 * The answers after a step. The card hands its calls over together once its last step has an answer (Skip and Dismiss
 * included), the template's `onComplete`, so the composer's open items change once per card (plan call P13).
 */
export interface StepResult {
	answers: AskUserAnswer[]
	/** Every call as a tool answer, in call order, once every step has an answer; null until then. */
	complete: ToolAnswer[] | null
}

const advance = (calls: readonly ToolPart[], answers: AskUserAnswer[]): StepResult => ({
	answers,
	complete: answers.length >= questionSteps(calls).length ? finishedCalls(calls, answers) : null,
})

/** The current step answered: an option, a free answer, or Skip. */
export const answerStep = (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
	answer: AskUserAnswer,
): StepResult => advance(calls, [...answers, answer])

/** Dismiss (the template's: "skip the rest"): the current step and every one after it are skipped. */
export const dismissSteps = (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
): StepResult => {
	const left = Math.max(questionSteps(calls).length - answers.length, 0)
	return advance(calls, [...answers, ...Array.from({ length: left }, () => SKIPPED)])
}

/** The template's keys: 1–9 pick the first nine options (a tenth, P2 allows ten, is picked by click only). */
export const DIGIT_KEYS = 9

/** The option a pressed key picks, or null (not a digit from 1, or no option under it). */
export const optionIndexOfKey = (key: string, optionCount: number): number | null => {
	if (!/^[1-9]$/.test(key)) return null
	const index = Number(key) - 1
	return index < optionCount ? index : null
}
