import { answerKindOf } from '@/lib/chat/interrupt-answers'
import {
	approvalDecisionOf,
	type AnsweredInterrupt,
	type ApprovalDecision,
} from '@/lib/chat/sent-answers'

import { toolDetail, type ToolDetail } from './tool-view-data'

/*
 * What a sent answer's receipt shows (the owner, 2026-10-15: "record everything that happens in the chat"), decided
 * outside React so the unit suite covers it (decision-receipt.tsx and answered-interrupt-card.tsx only render it).
 * Client-safe.
 */

/**
 * The receipt's mark: an approval's decision (spec §6.1), a confirmation's Yes or No (plan call P6), a form's
 * Submitted (the owner, 2026-10-15: "make it submitted"), or Answered for anything else.
 */
export type ReceiptMark = ApprovalDecision | 'yes' | 'no' | 'submitted' | 'answered'

/**
 * Each mark's colour, antd Typography's `type` (`antd info Typography --version 6.6.5`: `secondary`, `success`,
 * `warning`, `danger`), and its existing key: the words the cards used while the answer was a draft.
 */
export const RECEIPT_MARKS = {
	approved: { tone: 'success', key: 'shared_chat.answer.approved' },
	rejected: { tone: 'danger', key: 'shared_chat.answer.rejected' },
	cancelled: { tone: 'secondary', key: 'shared_chat.answer.cancelled' },
	yes: { tone: 'success', key: 'shared_chat.interrupt.yes' },
	no: { tone: 'danger', key: 'shared_chat.interrupt.no' },
	submitted: { tone: 'success', key: 'shared_chat.answer.submitted' },
	answered: { tone: 'success', key: 'shared_chat.answer.answered' },
} as const satisfies Record<
	ReceiptMark,
	{ tone: 'success' | 'danger' | 'secondary'; key: `shared_chat.${string}` }
>

/** An answered interrupt's receipt: its mark, and the values a form sent (or nothing to show). */
export interface AnsweredReceipt {
	mark: ReceiptMark
	values: ToolDetail
}

const NO_VALUES: ToolDetail = { kind: 'empty' }

/**
 * The receipt of an answer to an interrupt with a card of its own (spec §6.3, plan calls P6–P8): Cancelled for a
 * cancelled one; otherwise by how the interrupt is answered (answerKindOf), Approved or Rejected for an approval by its
 * own schema's key, Yes or No for a confirmation, Submitted for a form and Answered for anything else, with the object it sent as
 * indented JSON, as the tool cards show their arguments (toolDetail: an empty object shows nothing).
 */
export const answeredReceipt = (answered: AnsweredInterrupt): AnsweredReceipt => {
	const { interrupt, status, payload } = answered
	if (status === 'cancelled') return { mark: 'cancelled', values: NO_VALUES }
	switch (answerKindOf(interrupt).kind) {
		case 'approval':
			return { mark: approvalDecisionOf(interrupt, answered), values: NO_VALUES }
		case 'confirm':
			return { mark: payload === true ? 'yes' : 'no', values: NO_VALUES }
		default:
			return {
				mark: answerKindOf(interrupt).kind === 'form' ? 'submitted' : 'answered',
				values: typeof payload === 'object' ? toolDetail(JSON.stringify(payload)) : NO_VALUES,
			}
	}
}
