import type { Interrupt } from '@ag-ui/core'

import { parseAskUserArgs } from '@/lib/chat/ask-user'
import { approvalKey, isApproval, isExpired } from '@/lib/chat/interrupt-answers'
import type { TurnOpenItems } from '@/lib/chat/open-items'
import type { ToolPart } from '@/lib/chat/turn'

import type { AnswerDraft } from './answers'
import { jsonRows, leafText, type JsonRow } from './json-tree'
import { inputHint } from './turn-parts'

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

/** An object, not an array: the arguments the summary line reads key by key. */
const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The card's summary line, the ThoughtChain item's `description` (the approved design of 2026-10-15, A.1; assistant-ui's
 * `ApprovalCard` reads arguments as key/value pairs, never JSON), one level deep (json-tree brief, item 4): each key of
 * an object as `key: value`, the value as its row shows it when it has no rows below it (json-tree.ts `leafText`: a
 * scalar, an array of scalars joined by `, `, `[]`, `{}`) and as `{…}` or `[…]` when it has; the pairs joined by ` · `,
 * on one line and cut like the input hint; an empty object as nothing. Anything that is not an object (an array, a
 * scalar, arguments still streaming) reads as the input hint (spec §5.3).
 */
export const toolSummary = (args: string): string => {
	const json = parseJson(args)
	if (!json || !isObject(json.value)) return inputHint(args)
	return inputHint(
		Object.entries(json.value)
			.map(([key, value]) => `${key}: ${leafText(value) ?? (Array.isArray(value) ? '[…]' : '{…}')}`)
			.join(' · '),
	)
}

/** One part of an expanded tool card, its arguments or its result, as the card renders it (A.2). */
export type ToolDetail =
	/** Nothing to show: no text, or an empty object. */
	| { kind: 'empty' }
	/** Text, as plain text with its line breaks. */
	| { kind: 'text'; text: string }
	/** An object or array: its rows for the antd tree table, and its JSON indented by two spaces for the JSON view. */
	| { kind: 'tree'; rows: JsonRow[]; json: string }

const EMPTY: ToolDetail = { kind: 'empty' }

/**
 * A.2 with the json-tree brief (items 1 and 3): every JSON object or array as the rows of one tree table (json-tree.ts),
 * with its indented JSON for the "Show JSON" toggle. Text that is not JSON (a plain-text result, arguments still
 * streaming) is shown as sent, a JSON string as its text (nothing when it is blank), and any other JSON scalar as sent;
 * an empty object is nothing to show, and an empty array, which a table would show as a table without rows, is shown as
 * sent like a scalar. The card puts all of it into text nodes, never HTML.
 */
export const toolDetail = (text: string): ToolDetail => {
	if (text.trim() === '') return EMPTY
	const json = parseJson(text)
	if (!json) return { kind: 'text', text }
	const { value } = json
	if (typeof value === 'string') return value.trim() === '' ? EMPTY : { kind: 'text', text: value }
	if (typeof value !== 'object' || value === null) return { kind: 'text', text }
	const rows = jsonRows(value)
	if (rows.length > 0) return { kind: 'tree', rows, json: JSON.stringify(value, null, 2) }
	return Array.isArray(value) ? { kind: 'text', text } : EMPTY
}

/** The `ask_user` call in the turn (spec §6.2; the full-stack template's `AskUserResult`). */
export type AskUserView =
	/** Its arguments are still streaming: nothing to read yet. */
	| { kind: 'pending' }
	/** It waits for its answers (or its run was stopped first): the questions it asked. */
	| { kind: 'questions'; questions: string[] }
	/** Answered: the Q/A transcript that went back to the agent, as it was sent (plan call P3). */
	| { kind: 'transcript'; text: string }
	/** Its arguments fail the tool's schema (plan call P3). */
	| { kind: 'invalid' }
	/** Answered with an error tool message: its text. */
	| { kind: 'error'; text: string }

/**
 * The template's rule ("once answered, the result is already a Q/A transcript, so render it as-is; while waiting, list
 * the questions"), with the hub's two additions: arguments that fail `askUserArgsSchema` read as an invalid question
 * (plan call P3), and an error answer shows its text. A result wins over the arguments, so an agent's own tool of the
 * same name still shows what it returned.
 */
export const askUserView = (part: ToolPart): AskUserView => {
	if (part.status === 'done') return { kind: 'transcript', text: part.result ?? '' }
	const args = parseAskUserArgs(part.args)
	if (!args) return part.status === 'running' ? { kind: 'pending' } : { kind: 'invalid' }
	if (part.status === 'error') return { kind: 'error', text: part.error ?? '' }
	return { kind: 'questions', questions: args.questions.map(question => question.question) }
}

export type ApprovalDecision = 'approved' | 'rejected' | 'cancelled'

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
