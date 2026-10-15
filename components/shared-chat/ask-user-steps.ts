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
 * option, Skip answers one question, Dismiss skips the rest. The owner's redesign (2026-10-15, Claude's question
 * prompt) adds going back: an earlier step's answer can be changed until the last step has one.
 *
 * The answers are a prefix: one per step from the first, so a step has an answer when its index is below
 * `answers.length`, and the first step without one is `answers.length`. The card's current step is that one, or an
 * earlier step the user went back to.
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
	/** The step the card shows next: the first one without an answer (`answers.length`). */
	next: number
}

const advance = (calls: readonly ToolPart[], answers: AskUserAnswer[]): StepResult => ({
	answers,
	complete: answers.length >= questionSteps(calls).length ? finishedCalls(calls, answers) : null,
	next: answers.length,
})

/**
 * Step `index` answered: an option, a free answer, or Skip. An earlier step's answer is replaced (the user went back);
 * the first step without an answer gets its first one. Either way the card moves on to the first step without one.
 */
export const answerStep = (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
	index: number,
	answer: AskUserAnswer,
): StepResult => {
	// The answers stay a prefix: a later step has no answer to replace and cannot take one before the steps above it.
	if (!Number.isInteger(index) || index < 0 || index > answers.length)
		throw new RangeError(`Step ${index} cannot take an answer: ${answers.length} steps have one`)
	return advance(calls, [...answers.slice(0, index), answer, ...answers.slice(index + 1)])
}

/** Dismiss (the template's: "skip the rest"): the current step and every one after it are skipped. */
export const dismissSteps = (
	calls: readonly ToolPart[],
	answers: readonly AskUserAnswer[],
): StepResult => {
	const left = Math.max(questionSteps(calls).length - answers.length, 0)
	return advance(calls, [...answers, ...Array.from({ length: left }, () => SKIPPED)])
}

/** ‹ (the previous question): every step but the first. */
export const canGoBack = (index: number): boolean => index > 0

/**
 * › (the next question): only from a step that has an answer, so › reaches an answered step or the first one without
 * an answer; Skip is how the user moves past a question without one.
 */
export const canGoForward = (index: number, answers: readonly AskUserAnswer[]): boolean =>
	index < answers.length

/** What a step shows as its answer when the card returns to it: the chosen option, or the free text in the input. */
export interface StepChoice {
	/** The index of the option whose text is the answer; null for a free answer, a skipped step or no answer. */
	option: number | null
	/** A free answer (any answer that is not exactly an option's text); '' otherwise. */
	text: string
}

export const stepChoice = (
	question: AskUserQuestion,
	answer: AskUserAnswer | undefined,
): StepChoice => {
	if (!answer || answer.skipped) return { option: null, text: '' }
	const option = question.options.indexOf(answer.answer)
	return option >= 0 ? { option, text: '' } : { option: null, text: answer.answer }
}

/** The template's keys: 1–9 pick the first nine options (a tenth, P2 allows ten, is picked by click only). */
export const DIGIT_KEYS = 9

/** The option a pressed key picks, or null (not a digit from 1, or no option under it). */
export const optionIndexOfKey = (key: string, optionCount: number): number | null => {
	if (!/^[1-9]$/.test(key)) return null
	const index = Number(key) - 1
	return index < optionCount ? index : null
}
