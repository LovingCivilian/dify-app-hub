import type { Interrupt } from '@ag-ui/core'

import { parseAskUserArgs } from '@/lib/chat/ask-user'
import { isExpired } from '@/lib/chat/interrupt-answers'
import { hasOpenItems, type TurnOpenItems } from '@/lib/chat/open-items'
import { INVALID_QUESTION_CONTENT } from '@/lib/chat/statuses'
import type { Turn } from '@/lib/chat/turn'

import type { ResumeAnswer, SharedChatInput, ToolAnswer } from './provider/ag-ui-chat-provider'

/*
 * The browser's answers to what a turn waits for (Part 2 spec §6; decision 62's third answer; plan calls P11, P13, P14):
 * one decision per open item, kept in a draft until the last open item has one, then all of them in one request, as
 * CopilotKit and assistant-ui wait for every interrupt (AG-UI 1.0 interrupt-resume: "The resume list MUST cover every
 * interrupt"). Pure and client-safe: useSharedChat keeps the draft per conversation key, and the cards read it.
 * `@ag-ui/core` is imported for its types only (spec §9).
 */

/** One card's decision: a resume entry for an interrupt, or the answer to an ask_user call. */
export type ItemAnswer = ({ kind: 'resume' } & ResumeAnswer) | ({ kind: 'tool' } & ToolAnswer)

/** The decisions so far, by interrupt id and by tool-call id (P13). */
export interface AnswerDraft {
	resume: Readonly<Record<string, ResumeAnswer>>
	tools: Readonly<Record<string, ToolAnswer>>
}

export const EMPTY_DRAFT: AnswerDraft = { resume: {}, tools: {} }

/** The draft with this decision; one already there for the same item is replaced ("Change", P13). */
export const withAnswer = (draft: AnswerDraft, answer: ItemAnswer): AnswerDraft => {
	if (answer.kind === 'resume') {
		const { kind: _kind, ...entry } = answer
		return { ...draft, resume: { ...draft.resume, [entry.interruptId]: entry } }
	}
	const { kind: _kind, ...entry } = answer
	return { ...draft, tools: { ...draft.tools, [entry.toolCallId]: entry } }
}

/** "Change" (P13): forgets the decision for an interrupt id or a tool-call id. */
export const withoutAnswer = (draft: AnswerDraft, itemId: string): AnswerDraft => {
	const { [itemId]: _resume, ...resume } = draft.resume
	const { [itemId]: _tool, ...tools } = draft.tools
	return { resume, tools }
}

/** The draft's entry for an id, as a list of none or one; own keys only, so an id like "toString" is no decision. */
const entryOf = <T>(record: Readonly<Record<string, T>>, id: string): T[] =>
	Object.hasOwn(record, id) ? [record[id]!] : []

/**
 * The draft's decision for an interrupt, as a list of none or one. Given `now`, a `resolved` decision for an interrupt
 * that has expired by then counts as none: only Dismiss (`cancelled`) answers it now (spec §6.1), and the server refuses
 * to resolve it (400 `answers_invalid`, spec §4.3), so the decision waits for the card's Dismiss instead of sending.
 */
const resumeEntryOf = (draft: AnswerDraft, interrupt: Interrupt, now?: Date): ResumeAnswer[] =>
	entryOf(draft.resume, interrupt.id).filter(
		({ status }) => !(status === 'resolved' && now !== undefined && isExpired(interrupt, now)),
	)

/** Whether every open item has a decision that holds at `now`, and something is open (decision 62's third answer). */
export const draftCovers = (open: TurnOpenItems, draft: AnswerDraft, now?: Date): boolean =>
	hasOpenItems(open) &&
	open.interrupts.every(interrupt => resumeEntryOf(draft, interrupt, now).length > 0) &&
	open.questions.every(({ toolCallId }) => Object.hasOwn(draft.tools, toolCallId))

/**
 * The run body's answers, in the open items' order, only for open items and decisions that still hold at `now`
 * (spec §4.2; an empty list is left out).
 */
export const answersBody = (
	open: TurnOpenItems,
	draft: AnswerDraft,
	now?: Date,
): NonNullable<SharedChatInput['answers']> => {
	const resume = open.interrupts.flatMap(interrupt => resumeEntryOf(draft, interrupt, now))
	const toolResults = open.questions.flatMap(({ toolCallId }) => entryOf(draft.tools, toolCallId))
	return {
		...(resume.length > 0 ? { resume } : {}),
		...(toolResults.length > 0 ? { toolResults } : {}),
	}
}

/**
 * The ask_user answers merged into the turn they continue: no TOOL_CALL_RESULT comes back for a frontend tool, so the
 * hub writes the answer into the turn itself (spec §6.2; spike, "Ask-user"). A call whose arguments read as questions
 * is `done` with its transcript; one whose arguments do not is `error` with the text the server stores for it, whatever
 * the browser sent (P3), as the reloaded turn shows it (lib/chat/turn.ts `foldRow`: an error's text is the content).
 */
export const withToolAnswers = (turn: Turn, answers: readonly ToolAnswer[]): Turn => {
	if (answers.length === 0) return turn
	const contents = new Map(answers.map(({ toolCallId, content }) => [toolCallId, content]))
	return {
		...turn,
		parts: turn.parts.map(part => {
			if (part.kind !== 'tool') return part
			const content = contents.get(part.toolCallId)
			if (content === undefined) return part
			return parseAskUserArgs(part.args)
				? { ...part, status: 'done' as const, result: content }
				: { ...part, status: 'error' as const, error: INVALID_QUESTION_CONTENT }
		}),
	}
}

/** What `answer` does with a decision (decision 62's third answer, P13): keep it, send everything, or ignore it. */
export type AnswerDecision =
	| { action: 'keep'; draft: AnswerDraft }
	| { action: 'send'; body: NonNullable<SharedChatInput['answers']> }
	| { action: 'ignore' }

const isOpen = (open: TurnOpenItems, answer: ItemAnswer): boolean =>
	answer.kind === 'resume'
		? open.interrupts.some(({ id }) => id === answer.interruptId)
		: open.questions.some(({ toolCallId }) => toolCallId === answer.toolCallId)

/**
 * A decision while a request runs is ignored (the answers have gone, or a message is on its way), and so is one for an
 * item that is not open (a card of a turn that no longer waits). Otherwise it joins the draft, and once every open item
 * has a decision that still holds at `now` (P14: a resolved one for an interrupt expired since does not), the whole
 * draft goes.
 */
export const decide = ({
	open,
	draft,
	answer,
	isRequesting,
	now,
}: {
	open: TurnOpenItems
	draft: AnswerDraft
	answer: ItemAnswer
	isRequesting: boolean
	now: Date
}): AnswerDecision => {
	if (isRequesting || !isOpen(open, answer)) return { action: 'ignore' }
	const next = withAnswer(draft, answer)
	return draftCovers(open, next, now)
		? { action: 'send', body: answersBody(open, next, now) }
		: { action: 'keep', draft: next }
}

/**
 * P14: the next `expiresAt` after `now` among the interrupts, in ms since the epoch, or null when none is ahead. One at
 * or before `now` has expired already (`@ag-ui/client` 1.0.2 `isInterruptExpired`: `new Date(expiresAt) <= now`), and a
 * value that is not a date never expires (`@ag-ui/core` 1.0.2 `Interrupt.expiresAt`: "a value that is not one leaves the
 * interrupt looking permanently unexpired"; `NaN > now` is false).
 */
export const nextExpiry = (interrupts: readonly Interrupt[], now: Date): number | null => {
	const ahead = interrupts.flatMap(({ expiresAt }) => {
		const at = expiresAt === undefined ? Number.NaN : new Date(expiresAt).getTime()
		return at > now.getTime() ? [at] : []
	})
	return ahead.length > 0 ? Math.min(...ahead) : null
}
