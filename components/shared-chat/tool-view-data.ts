import type { Interrupt } from '@ag-ui/core'

import { parseAskUserArgs } from '@/lib/chat/ask-user'
import { approvalKey, isApproval, isExpired } from '@/lib/chat/interrupt-answers'
import type { TurnOpenItems } from '@/lib/chat/open-items'
import type { ToolPart } from '@/lib/chat/turn'

import type { AnswerDraft } from './answers'
import { flatFields, type Field } from './flat-fields'
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

/**
 * The card's summary line, the ThoughtChain item's `description` (the approved design of 2026-10-15, A.1; assistant-ui's
 * `ApprovalCard` reads arguments as key/value pairs, never JSON): arguments that are a flat object (flat-fields.ts) as
 * `key: value` pairs joined by ` · `, on one line and cut like the input hint; an empty object as nothing; anything
 * else (nested, an array, arguments still streaming) as the input hint (spec §5.3).
 */
export const toolSummary = (args: string): string => {
	const json = parseJson(args)
	const fields = json && flatFields(json.value)
	return fields
		? inputHint(fields.map(({ key, value }) => `${key}: ${value}`).join(' · '))
		: inputHint(args)
}

/** One part of an expanded tool card, its arguments or its result, as the card renders it (A.2). */
export type ToolDetail =
	/** Nothing to show: no text, or an empty object. */
	| { kind: 'empty' }
	/** Text, as plain text with its line breaks. */
	| { kind: 'text'; text: string }
	/** A flat object, as antd Descriptions. */
	| { kind: 'fields'; items: Field[] }
	/** Nested JSON or an array, indented by two spaces for X CodeHighlighter. */
	| { kind: 'json'; text: string }

/**
 * A.2: a flat object as fields (flat-fields.ts) and only nested or array JSON as code, so the code panel appears where
 * structure needs it (AI Elements' `Tool` shows a string output as text and an object as code). Text that is not JSON
 * (a plain-text result, arguments still streaming) is shown as sent, a JSON string as its text, and any other JSON
 * scalar as sent. The card puts all of it into text nodes, never HTML.
 */
export const toolDetail = (text: string): ToolDetail => {
	if (text.trim() === '') return { kind: 'empty' }
	const json = parseJson(text)
	if (!json) return { kind: 'text', text }
	const { value } = json
	if (typeof value === 'string') return { kind: 'text', text: value }
	const fields = flatFields(value)
	if (fields) return fields.length > 0 ? { kind: 'fields', items: fields } : { kind: 'empty' }
	return typeof value === 'object' && value !== null
		? { kind: 'json', text: JSON.stringify(value, null, 2) }
		: { kind: 'text', text }
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
