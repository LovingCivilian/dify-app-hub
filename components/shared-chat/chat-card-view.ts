import type { Interrupt } from '@ag-ui/core'

import { answerKindOf, isExpired } from '@/lib/chat/interrupt-answers'

import type { ReceiptMark } from './answer-receipt'
import type { InterruptCardView } from './interrupt-form'

/*
 * What the chat's cards show in their headers beside the tool card's (chat-card.tsx draws them all; the owner,
 * 2026-10-15: "make everything follow that"), decided outside React so the unit suite covers it, as tool-view-data.ts
 * `toolBadge` and answer-receipt.ts do. Client-safe: `@ag-ui/core` is imported for its types only (spec §9).
 */

/** An interrupt card's header icon, by how the interrupt is answered (answerKindOf, spec §6.3, plan calls P6–P8). */
export type InterruptIcon = 'form' | 'confirm' | 'approval' | 'other'

/** A form, a confirmation, an approval whose call has no tool part in the turn, or anything else. */
export const interruptIcon = (interrupt: Interrupt): InterruptIcon => {
	const { kind } = answerKindOf(interrupt)
	return kind === 'cancel' ? 'other' : kind
}

/** A status badge of the cards other than the tool card's (tool-chain.tsx keeps its own). */
export type CardBadge =
	| 'waiting'
	| 'expired'
	| 'answered'
	| 'approved'
	| 'rejected'
	| 'cancelled'
	| 'progress'
	| 'completed'

/**
 * Each badge's antd Tag colour, one of the preset status colours (`processing`, `success`, `error`, `warning`,
 * `default`: the Tag "status" demo, `antd demo Tag status --version 6.6.5`), and its key: the words the tool card and
 * the receipts already use, with `shared_chat.interrupt.waiting` and `shared_chat.plan.progress` new.
 */
export const CARD_BADGES = {
	waiting: { color: 'warning', key: 'shared_chat.interrupt.waiting' },
	expired: { color: 'warning', key: 'shared_chat.answer.expired' },
	answered: { color: 'success', key: 'shared_chat.answer.answered' },
	approved: { color: 'success', key: 'shared_chat.answer.approved' },
	rejected: { color: 'error', key: 'shared_chat.answer.rejected' },
	cancelled: { color: 'default', key: 'shared_chat.answer.cancelled' },
	progress: { color: 'processing', key: 'shared_chat.plan.progress' },
	completed: { color: 'success', key: 'shared_chat.tool_status.completed' },
} as const satisfies Record<
	CardBadge,
	{
		color: 'processing' | 'success' | 'error' | 'warning' | 'default'
		key: `shared_chat.${string}`
	}
>

/** An open interrupt waits for the user until its `expiresAt` passes (plan call P14), then reads "Expired". */
export const openInterruptBadge = (
	interrupt: Pick<Interrupt, 'expiresAt'>,
	now: Date,
): 'waiting' | 'expired' => (isExpired(interrupt, now) ? 'expired' : 'waiting')

/**
 * An answered interrupt's badge, by its receipt (answer-receipt.ts): an approval's decision, Cancelled, or Answered,
 * also for a confirmation, whose receipt in the body says Yes or No.
 */
export const answeredBadge = (
	mark: ReceiptMark,
): 'answered' | 'approved' | 'rejected' | 'cancelled' =>
	mark === 'approved' || mark === 'rejected' || mark === 'cancelled' ? mark : 'answered'

/** The plan panel's badge: its progress while a step is left, Completed once every step is (planProgress). */
export const planBadge = ({ complete }: { complete: boolean }): 'progress' | 'completed' =>
	complete ? 'completed' : 'progress'

type DraftKey = Extract<InterruptCardView, { kind: 'decided' }>['tagKey']

/** A drafted decision's Tag colour (decision-note.tsx), as approval-actions.tsx and the receipts colour them. */
const DRAFT_TAG_COLORS = {
	'shared_chat.answer.approved': 'success',
	'shared_chat.answer.rejected': 'error',
	'shared_chat.answer.cancelled': 'default',
	'shared_chat.answer.answered': 'success',
	'shared_chat.interrupt.yes': 'success',
	'shared_chat.interrupt.no': 'error',
} as const satisfies Record<DraftKey, 'success' | 'error' | 'default'>

export const draftTagColor = (tagKey: DraftKey): (typeof DRAFT_TAG_COLORS)[DraftKey] =>
	DRAFT_TAG_COLORS[tagKey]
