'use client'

import { Card, Descriptions, Flex, theme } from 'antd'
import { useTranslation } from 'react-i18next'

import type { AnsweredInterrupt } from '@/lib/chat/sent-answers'

import { answeredReceipt } from './answer-receipt'
import { cardBadge, INTERRUPT_ICONS } from './card-icons'
import ChatCard from './chat-card'
import { answeredBadge, interruptIcon } from './chat-card-view'
import CodeSection from './code-section'
import DecisionReceipt from './decision-receipt'
import { flatFields } from './flat-fields'
import { interruptTitleKey } from './interrupt-form'
import RequestMessage from './request-message'

/**
 * An interrupt the user answered, read-only, in the turn it continued (the owner, 2026-10-15: "record everything that
 * happens in the chat, so even with other browsers or devices, it will still have all the data"): the card the open
 * interrupt had (interrupt-card.tsx: the same icon and title, from its reason; chat-card.tsx), open at first and
 * collapsible as a completed tool card is. Its badge says how it was answered (chat-card-view.ts `answeredBadge`). Its
 * body as a completed tool card's: the message and a form's values with no border (a flat object as antd Descriptions,
 * `antd info Descriptions --version 6.6.5`, as the activity card shows one; anything else as JSON, CodeSection), then
 * the answer that went in the bordered box (an antd Card `size="small"`), where the open card had its buttons: the box
 * holds only the choice (the owner, 2026-10-15: "the inner border should be for the choice you selected, like in the
 * tool"). Every agent string renders as text.
 */
export default function AnsweredInterruptCard({ answered }: { answered: AnsweredInterrupt }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { interrupt } = answered
	const titleKey = interruptTitleKey(interrupt.reason)
	const receipt = answeredReceipt(answered)
	const fields = receipt.values.kind === 'empty' ? null : flatFields(answered.payload)
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
				{interrupt.message && <RequestMessage>{interrupt.message}</RequestMessage>}
				{fields ? (
					<Descriptions
						size="small"
						column={1}
						items={fields.map(field => ({
							key: field.key,
							label: field.key,
							children: field.value,
						}))}
					/>
				) : (
					<CodeSection detail={receipt.values} />
				)}
				<Card size="small">
					<DecisionReceipt mark={receipt.mark} />
				</Card>
			</Flex>
		</ChatCard>
	)
}
