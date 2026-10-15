import type { Interrupt } from '@ag-ui/core'

import {
	askUserAnswersOf,
	parseAskUserArgs,
	type AskUserAnswer,
	type AskUserArgs,
} from '@/lib/chat/ask-user'
import { approvalKey, isApproval, isExpired } from '@/lib/chat/interrupt-answers'
import type { TurnOpenItems } from '@/lib/chat/open-items'
import type { ApprovalDecision } from '@/lib/chat/sent-answers'
import type { ToolPart, ToolStatus } from '@/lib/chat/turn'

import type { AnswerDraft } from './answers'

/*
 * What the tool cards show, decided outside React so the unit suite covers it (tool-views.tsx, approval-actions.tsx and
 * tool-chain.tsx only render it). Client-safe: `@ag-ui/core` is imported for its types only (spec §9).
 */

/** JSON's value of `text`, or null when it does not parse (arguments still streaming, a plain-text result). */
const parseJson = (text: string): { value: unknown } | null => {
	try {
		return { value: JSON.parse(text) }
	} catch {
		return null
	}
}

/**
 * One part of an expanded tool card, its arguments or its result, as AI Elements' `Tool` shows it: a code block (its
 * `ToolInput` and `ToolOutput`: JSON in a `CodeBlock`, a string output in one too; vercel/ai-elements
 * `packages/elements/src/tool.tsx`; the owner, 2026-10-15: "Parameters and Result be plain JSON code blocks like AI
 * Elements").
 */
export type ToolDetail =
	/** Nothing to show: no text, a blank string, or an empty object. */
	| { kind: 'empty' }
	/** The code block's text and language: JSON indented by two spaces, or text as sent, read as Markdown source. */
	| { kind: 'code'; code: string; lang: 'json' | 'markdown' }

const EMPTY: ToolDetail = { kind: 'empty' }

/**
 * Any JSON value but a string as indented JSON; a JSON string, and text that is not JSON (a plain-text result,
 * arguments still streaming), as its text in a Markdown block (the owner, 2026-10-15: "for the language use md"). The
 * card puts it into the code block as text, never HTML.
 */
export const toolDetail = (text: string): ToolDetail => {
	if (text.trim() === '') return EMPTY
	const json = parseJson(text)
	if (!json) return { kind: 'code', code: text, lang: 'markdown' }
	const { value } = json
	if (typeof value === 'string')
		return value.trim() === '' ? EMPTY : { kind: 'code', code: value, lang: 'markdown' }
	if (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === 0
	)
		return EMPTY
	return { kind: 'code', code: JSON.stringify(value, null, 2), lang: 'json' }
}

/**
 * The status badge in a tool card's header (AI Elements' `getStatusBadge`: Pending, Running, Completed, Error, Awaiting
 * Approval…), from the call's status and, in the turn that waits, its approval: an open approval reads "Awaiting
 * approval" and an expired one "Expired" over the call's own `waiting` (plan call P9).
 */
export type ToolBadge =
	| 'running'
	| 'waiting'
	| 'completed'
	| 'error'
	| 'stopped'
	| 'awaiting_approval'
	| 'expired'

const STATUS_BADGES: Record<ToolStatus, ToolBadge> = {
	running: 'running',
	waiting: 'waiting',
	done: 'completed',
	error: 'error',
	stopped: 'stopped',
}

export const toolBadge = (status: ToolStatus, approval: ApprovalView | null): ToolBadge => {
	if (approval?.kind === 'open') return 'awaiting_approval'
	if (approval?.kind === 'expired') return 'expired'
	return STATUS_BADGES[status]
}

/**
 * Whether a tool card starts open: AI Elements opens completed and failed tools ("Auto-opens completed tools by default",
 * its Tool docs), and a call that waits for its approval opens so its arguments are in view beside Approve and Reject.
 */
export const toolOpenByDefault = (badge: ToolBadge): boolean =>
	badge === 'completed' || badge === 'error' || badge === 'awaiting_approval'

/** The `ask_user` call in the turn (spec §6.2; the full-stack template's `AskUserResult`). */
export type AskUserView =
	/** Its arguments are still streaming: nothing to read yet. */
	| { kind: 'pending' }
	/** It waits for its answers (or its run was stopped first): the questions it asked. */
	| { kind: 'questions'; questions: string[] }
	/**
	 * Answered, or its answers wait in the draft (plan call P13): each question with its answer, read back from the Q/A
	 * transcript (plan call P3; askUserAnswersOf).
	 */
	| { kind: 'answers'; answers: { question: string; answer: AskUserAnswer }[] }
	/** Answered with a result that is not the transcript of its questions: the result as it was sent. */
	| { kind: 'transcript'; text: string }
	/** Its arguments fail the tool's schema (plan call P3). */
	| { kind: 'invalid' }
	/** Answered with an error tool message: its text. */
	| { kind: 'error'; text: string }

/** Each question beside its answer, when the text is the transcript of these questions (askUserAnswersOf). */
const answersView = (args: AskUserArgs | null, transcript: string): AskUserView | null => {
	const answers = args && askUserAnswersOf(args.questions, transcript)
	return answers
		? {
				kind: 'answers',
				answers: args.questions.map((question, index) => ({
					question: question.question,
					answer: answers[index],
				})),
			}
		: null
}

/**
 * The template's rule ("once answered, the result is already a Q/A transcript, so render it as-is; while waiting, list
 * the questions"), with the hub's additions: the transcript of the call's own questions reads as each question with
 * its answer (the owner, 2026-10-15: the content without a border and the choice in the box), as do the answers that
 * wait in the draft (`drafted`, their transcript); arguments that fail `askUserArgsSchema` read as an invalid question
 * (plan call P3), and an error answer shows its text. A result wins over the arguments, so an agent's own tool of the
 * same name still shows what it returned.
 */
export const askUserView = (part: ToolPart, drafted?: string): AskUserView => {
	const args = parseAskUserArgs(part.args)
	if (part.status === 'done') {
		const text = part.result ?? ''
		return answersView(args, text) ?? { kind: 'transcript', text }
	}
	if (!args) return part.status === 'running' ? { kind: 'pending' } : { kind: 'invalid' }
	if (part.status === 'error') return { kind: 'error', text: part.error ?? '' }
	return (
		(drafted === undefined ? null : answersView(args, drafted)) ?? {
			kind: 'questions',
			questions: args.questions.map(question => question.question),
		}
	)
}

/** A decision on an approval, in the draft or sent (lib/chat/sent-answers.ts owns the type, so lib/chat reads it too). */
export type { ApprovalDecision } from '@/lib/chat/sent-answers'

/** The gated call's footer (spec §6.1): open, expired, or decided (plan call P13). */
export type ApprovalView =
	| { kind: 'open' }
	| { kind: 'expired' }
	| { kind: 'decided'; decision: ApprovalDecision }

/**
 * A Dismiss in the draft stays one; otherwise an approval past its `expiresAt` can only be dismissed (spec §6.1; plan
 * call P14), even with an Approve or Reject recorded before it expired ("Expiry forecloses ANSWERING", @ag-ui/client
 * 1.0.2 `src/agent/agent.ts`), as Task 13's `interruptCardView` reads every other interrupt. A recorded decision reads
 * the payload Approve built: the schema's own boolean property true (plan call P5); it can be changed until the last
 * item has one (plan call P13). The draft is read by own key only: an interrupt id is the agent's string.
 */
export const approvalView = (
	interrupt: Interrupt,
	{ draft, now }: { draft: AnswerDraft; now: Date },
): ApprovalView => {
	const recorded = Object.hasOwn(draft.resume, interrupt.id)
		? draft.resume[interrupt.id]
		: undefined
	if (recorded?.status === 'cancelled') return { kind: 'decided', decision: 'cancelled' }
	if (isExpired(interrupt, now)) return { kind: 'expired' }
	if (!recorded) return { kind: 'open' }
	const { payload } = recorded
	return {
		kind: 'decided',
		decision:
			typeof payload === 'object' && payload[approvalKey(interrupt.responseSchema)] === true
				? 'approved'
				: 'rejected',
	}
}

/** What a tool's ThoughtChain item carries below its body, in the turn that waits. */
export type ToolFooter = { kind: 'approval'; interrupt: Interrupt } | { kind: 'answered' } | null

/**
 * The open approval that names the call (spec §6.1: reason `tool_call` with its `toolCallId`) puts Approve and Reject
 * on it; an open `ask_user` call whose answers wait in the draft reads "Answered" with Change (plan call P13), since the
 * card above the composer shows only the calls without a decision (Task 15).
 */
export const toolFooter = (
	part: ToolPart,
	{ open, draft }: { open: TurnOpenItems; draft: AnswerDraft },
): ToolFooter => {
	const approval = open.interrupts.find(
		interrupt => isApproval(interrupt) && interrupt.toolCallId === part.toolCallId,
	)
	if (approval) return { kind: 'approval', interrupt: approval }
	const asked = open.questions.some(question => question.toolCallId === part.toolCallId)
	return asked && Object.hasOwn(draft.tools, part.toolCallId) ? { kind: 'answered' } : null
}
