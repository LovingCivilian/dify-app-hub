'use client'

import { Button, Flex, Tag, Typography } from 'antd'
import type { TagProps } from 'antd'
import { use } from 'react'
import { useTranslation } from 'react-i18next'

import { TurnAnswersContext } from './answer-context'
import { draftCovers } from './answers'

export interface DecisionNoteProps {
	/** The interrupt id or tool-call id the decision answers (the draft's key). */
	itemId: string
	color: TagProps['color']
	label: string
}

/**
 * A decision in the draft (plan call P13): its Tag, Change (`retract`), which brings the item back, and "Waiting for
 * the other answers" while another open item has none that holds now (an Approve recorded before its interrupt expired
 * holds no longer, Task 10's `draftCovers`), since the answers go together when the last one is in (decision 62's
 * third answer). Outside a waiting chat it renders nothing.
 */
export default function DecisionNote({ itemId, color, label }: DecisionNoteProps) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	if (!answers) return null
	return (
		<Flex
			wrap
			gap="small"
			align="center"
		>
			<Tag color={color}>{label}</Tag>
			<Button
				type="link"
				size="small"
				disabled={answers.disabled}
				onClick={() => answers.retract(itemId)}
			>
				{t('shared_chat.answer.change')}
			</Button>
			{!draftCovers(answers.open, answers.draft, answers.now) && (
				<Typography.Text type="secondary">{t('shared_chat.answer.waiting_others')}</Typography.Text>
			)}
		</Flex>
	)
}
