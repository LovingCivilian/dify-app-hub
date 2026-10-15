'use client'

import { ThunderboltOutlined } from '@ant-design/icons'
import { Descriptions, Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { TurnPart } from '@/lib/chat/turn'

import { activityView } from './activity-view'
import ChatCard from './chat-card'
import CodeSection from './code-section'

/**
 * An `activity` part, read-only in the turn (spec §6.4, plan call P17): the chat's card (chat-card.tsx), open at first
 * and collapsible as a completed tool card is, titled with its `activityType` (AG-UI 1.0 spec, Events › Activity: an
 * open string, and "a consumer MUST tolerate types it does not recognise"); a flat `content` as antd Descriptions,
 * anything else as indented JSON in the cards' code block (CodeSection, labelled "Content"), cut at 10 KB with a note
 * (`activityView`). Keys, values and the type render as text nodes, never HTML.
 */
export default function ActivityCard({ part }: { part: Extract<TurnPart, { kind: 'activity' }> }) {
	const { t } = useTranslation()
	const view = useMemo(() => activityView(part.content), [part.content])
	return (
		<ChatCard
			defaultOpen
			icon={<ThunderboltOutlined />}
			title={part.activityType}
		>
			{view.kind === 'fields' ? (
				<Descriptions
					size="small"
					column={1}
					items={view.items.map(item => ({ key: item.key, label: item.key, children: item.value }))}
				/>
			) : (
				<Flex
					vertical
					gap="small"
				>
					<CodeSection
						label={t('shared_chat.activity.content')}
						detail={{ kind: 'code', code: view.text, lang: 'json' }}
					/>
					{view.truncated && (
						<Typography.Text type="secondary">
							{t('shared_chat.activity.truncated')}
						</Typography.Text>
					)}
				</Flex>
			)}
		</ChatCard>
	)
}
