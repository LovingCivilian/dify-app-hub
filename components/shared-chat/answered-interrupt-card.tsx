'use client'

import { Card, Flex, theme } from 'antd'
import { useTranslation } from 'react-i18next'

import type { AnsweredInterrupt } from '@/lib/chat/sent-answers'

import { answeredReceipt } from './answer-receipt'
import { cardBadge, INTERRUPT_ICONS } from './card-icons'
import ChatCard from './chat-card'
import { answeredBadge, interruptIcon } from './chat-card-view'
import CodeSection from './code-section'
import DecisionReceipt from './decision-receipt'
import { interruptTitleKey } from './interrupt-form'
import RequestMessage from './request-message'

/**
 * An interrupt the user answered, read-only, in the turn it continued (the owner, 2026-10-15: "record everything that
 * happens in the chat, so even with other browsers or devices, it will still have all the data"): the card the open
 * interrupt had (interrupt-card.tsx: the same icon and title, from its reason; chat-card.tsx), open at first and
 * collapsible as a completed tool card is. Its badge says how it was answered (chat-card-view.ts `answeredBadge`):
 * Approved or Rejected, Cancelled, or Answered. Its body: the bordered box (an antd Card `size="small"`, `antd info Card
 * --version 6.6.5`) with its message and the answer that went (answer-receipt.ts: Cancelled, Yes or No, Approved or
 * Rejected, or Answered), where the open card had its controls, then a form's values as JSON (CodeSection). Every agent
 * string renders as text.
 */
export default function AnsweredInterruptCard({ answered }: { answered: AnsweredInterrupt }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
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
			{/* The tool card's body spacing between its sections (tool-views.tsx ToolCallDetails). */}
			<Flex
				vertical
				gap={token.marginSM}
			>
				<Card size="small">
					<Flex
						vertical
						gap="small"
					>
						{interrupt.message && <RequestMessage>{interrupt.message}</RequestMessage>}
						<DecisionReceipt mark={receipt.mark} />
					</Flex>
				</Card>
				<CodeSection detail={receipt.values} />
			</Flex>
		</ChatCard>
	)
}
