'use client'

import { CheckCircleOutlined, CloseCircleOutlined, MinusCircleOutlined } from '@ant-design/icons'
import { Flex, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import { RECEIPT_MARKS, type ReceiptMark } from './answer-receipt'

/** Each colour's icon, the tool cards' status icons (tool-chain.tsx: completed, error, stopped). */
const ICONS = {
	success: <CheckCircleOutlined />,
	danger: <CloseCircleOutlined />,
	secondary: <MinusCircleOutlined />,
} as const

/**
 * A sent answer, read-only (the owner, 2026-10-15: "record everything that happens in the chat"): an icon and its label
 * in the mark's colour, antd Typography `type` (`antd info Typography --version 6.6.5`), as AI Elements' `Tool` keeps
 * "✓ Accepted" where its request was. It has no Change: the answer went.
 */
export default function DecisionReceipt({ mark }: { mark: ReceiptMark }) {
	const { t } = useTranslation()
	const { tone, key } = RECEIPT_MARKS[mark]
	return (
		<Flex
			align="center"
			gap="small"
		>
			<Typography.Text type={tone}>{ICONS[tone]}</Typography.Text>
			<Typography.Text type={tone}>{t(key)}</Typography.Text>
		</Flex>
	)
}
