'use client'

import { useTranslation } from 'react-i18next'

import type { AnsweredInterrupt } from '@/lib/chat/sent-answers'

import AnswerRecord from './answer-record'
import { answeredReceipt } from './answer-receipt'
import { cardBadge, INTERRUPT_ICONS } from './card-icons'
import ChatCard from './chat-card'
import { answeredBadge, interruptIcon } from './chat-card-view'
import DecisionReceipt from './decision-receipt'
import { interruptTitleKey } from './interrupt-form'

/**
 * An interrupt the user answered, read-only, in the turn it continued (the owner, 2026-10-15: "record everything that
 * happens in the chat, so even with other browsers or devices, it will still have all the data"): the card the open
 * interrupt had (interrupt-card.tsx: the same icon and title, from its reason; chat-card.tsx), open at first and
 * collapsible as a completed tool card is. Its badge says how it was answered (chat-card-view.ts `answeredBadge`). Its
 * body (answer-record.tsx): the message and a form's values with no border, then the receipt alone in the bordered box.
 */
export default function AnsweredInterruptCard({ answered }: { answered: AnsweredInterrupt }) {
	const { t } = useTranslation()
	const { interrupt } = answered
	const titleKey = interruptTitleKey(interrupt.reason)
	const receipt = answeredReceipt(answered)
	return (
		<ChatCard
			defaultOpen
			icon={INTERRUPT_ICONS[interruptIcon(interrupt)]}
			title={titleKey ? t(titleKey) : interrupt.reason}
			badge={cardBadge(answeredBadge(receipt.mark), t)}
		>
			<AnswerRecord
				message={interrupt.message}
				values={receipt.values}
				payload={answered.payload}
			>
				<DecisionReceipt mark={receipt.mark} />
			</AnswerRecord>
		</ChatCard>
	)
}
