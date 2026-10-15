import type { Interrupt } from '@ag-ui/core'

import { approvalKey, isApproval } from './interrupt-answers'
import type { Turn, TurnPart } from './turn'

/*
 * The answers a user sent to a turn's interrupts, recorded in the turn (the owner, 2026-10-15: "record everything that
 * happens in the chat, so even with other browsers or devices, it will still have all the data"). The server stores
 * each answering run's answers on `conversation_runs.resume` (lib/data/conversations.ts `startRun`, the list
 * lib/chat/answers.ts `checkAnswers` built with @ag-ui/client's `buildResumeArray`); the history reads them back
 * (lib/chat/turn.ts `turnsFromMessages`) and the browser records the same when the answers go (the provider's
 * `transformParams`), both through `withSentAnswers`, so a reload shows what the live view showed. Only answers that
 * were sent: a draft stays in the browser. Client-safe: `@ag-ui/core` is imported for its types only (spec §9).
 */

/** One answer that went to the agent: AG-UI 1.0 interrupt-resume's `{ interruptId, status, payload? }` (P5–P8). */
export interface SentAnswer {
	interruptId: string
	status: 'resolved' | 'cancelled'
	/** An approval's or a form's object, or a confirmation's bare boolean (plan call P6). */
	payload?: Record<string, unknown> | boolean
}

/** A sent answer to an approval, as the gated call's card shows it (spec §6.1). */
export type ApprovalDecision = 'approved' | 'rejected' | 'cancelled'

/** A sent answer to an interrupt no tool part of its turn shows: a form, a confirmation, a cancel-only or unbound one. */
export interface AnsweredInterrupt {
	interrupt: Interrupt
	status: SentAnswer['status']
	payload?: SentAnswer['payload']
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const isSentAnswer = (value: unknown): value is SentAnswer =>
	isRecord(value) &&
	typeof value.interruptId === 'string' &&
	(value.status === 'resolved' || value.status === 'cancelled') &&
	(value.payload === undefined || isRecord(value.payload) || typeof value.payload === 'boolean')

/**
 * A stored run's `resume`, read with the tolerance of its `outcome` (lib/chat/turn.ts `interruptsOf`): the list the hub
 * stored, or no answers for anything that is not a list of answers (null for a run that answered nothing). Each entry
 * keeps only the fields the turn reads.
 */
export const readResume = (value: unknown): SentAnswer[] =>
	Array.isArray(value) && value.every(isSentAnswer)
		? value.map(({ interruptId, status, payload }) =>
				payload === undefined ? { interruptId, status } : { interruptId, status, payload },
			)
		: []

/**
 * An approval's answer (spec §6.1): Dismiss is `cancelled`; a resolved answer is `approved` when its payload sets the
 * interrupt's own approval key true, the payload Approve builds (approvalPayload, plan call P5), and `rejected`
 * otherwise ("Denials are expressed inside the payload", AG-UI concepts › Interrupts, "Resuming a run").
 */
export const approvalDecisionOf = (
	interrupt: Pick<Interrupt, 'responseSchema'>,
	{ status, payload }: Pick<SentAnswer, 'status' | 'payload'>,
): ApprovalDecision => {
	if (status === 'cancelled') return 'cancelled'
	return isRecord(payload) && payload[approvalKey(interrupt.responseSchema)] === true
		? 'approved'
		: 'rejected'
}

/**
 * The answers that went, recorded in the turn they continue, over the interrupts they answered (`open`: the turn's open
 * interrupts when they went, or after a reload those of the run the answering run continued): an approval whose
 * `toolCallId` names one of the turn's tool parts sets that part's `decision`, as the call's card answered it (spec
 * §6.1); every other answer is appended to `answered` in the order sent, as its own card answered it (spec §6.3, plan
 * call P8). An answer to an interrupt not in `open` is ignored. The open items are not this function's: the turn's
 * `interrupts` stay as they are.
 */
export const withSentAnswers = (
	turn: Turn,
	open: readonly Interrupt[],
	resume: readonly SentAnswer[],
): Turn => {
	if (resume.length === 0) return turn
	// A Map, so an id like "toString" finds nothing: an interrupt id is the agent's string.
	const byId = new Map(open.map(interrupt => [interrupt.id, interrupt]))
	const calls = new Set(turn.parts.flatMap(part => (part.kind === 'tool' ? [part.toolCallId] : [])))
	const decisions = new Map<string, ApprovalDecision>()
	const answered = [...turn.answered]
	for (const answer of resume) {
		const interrupt = byId.get(answer.interruptId)
		if (!interrupt) continue
		const call = isApproval(interrupt) ? interrupt.toolCallId : undefined
		if (call !== undefined && calls.has(call))
			decisions.set(call, approvalDecisionOf(interrupt, answer))
		else
			answered.push(
				answer.payload === undefined
					? { interrupt, status: answer.status }
					: { interrupt, status: answer.status, payload: answer.payload },
			)
	}
	const parts = turn.parts.map((part): TurnPart => {
		if (part.kind !== 'tool') return part
		const decision = decisions.get(part.toolCallId)
		return decision ? { ...part, decision } : part
	})
	return { ...turn, parts, answered }
}
