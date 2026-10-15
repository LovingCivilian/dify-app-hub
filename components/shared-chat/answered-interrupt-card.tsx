'use client'

import { Card, Flex, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import type { AnsweredInterrupt } from '@/lib/chat/sent-answers'

import { answeredReceipt } from './answer-receipt'
import CodeSection from './code-section'
import DecisionReceipt from './decision-receipt'
import { interruptTitleKey } from './interrupt-form'

/**
 * An interrupt the user answered, read-only, in the turn it continued (the owner, 2026-10-15: "record everything that
 * happens in the chat, so even with other browsers or devices, it will still have all the data"): the antd Card the
 * open interrupt had (interrupt-card.tsx: `size="small"`, `variant="outlined"`, `title`; `antd info Card --version
 * 6.6.5`), titled from its reason (the three core reasons localised, any other as sent), its message, then the answer
 * that went (answer-receipt.ts): Cancelled, Yes or No, Approved or Rejected, or Answered with the form's values as JSON.
 * Every agent string renders as text.
 */
export default function AnsweredInterruptCard({ answered }: { answered: AnsweredInterrupt }) {
	const { t } = useTranslation()
	const { interrupt } = answered
	const titleKey = interruptTitleKey(interrupt.reason)
	const receipt = answeredReceipt(answered)
	return (
		<Card
			size="small"
			variant="outlined"
			title={titleKey ? t(titleKey) : interrupt.reason}
		>
			<Flex
				vertical
				gap="small"
			>
				{interrupt.message && <Typography.Text>{interrupt.message}</Typography.Text>}
				<DecisionReceipt mark={receipt.mark} />
				<CodeSection detail={receipt.values} />
			</Flex>
		</Card>
	)
}
