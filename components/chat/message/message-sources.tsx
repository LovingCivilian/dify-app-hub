'use client'

import { FileTextOutlined, GlobalOutlined } from '@ant-design/icons'
import { Sources, type SourcesProps } from '@ant-design/x'
import { Card, Flex, Tag, Typography } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { IRetrieverResource } from '@/lib/api'

import { citationKey, citationTitle } from './citations'
import { formatCount, formatDecimal } from './workflow-summary'

const EXCERPT_ELLIPSIS = { rows: 6, expandable: true } as const

/**
 * Knowledge-base citations (spec §5.2) in X Sources, collapsed under the answer. Dify's citations have no
 * URL, and Sources shows an item's `description` only in its inline mode, so the excerpt of the item
 * picked (Sources `onClick`) is shown below the list with its retrieval figures.
 */
export default function MessageSources({ citations }: { citations?: IRetrieverResource[] }) {
	const { t, i18n } = useTranslation()
	const language = i18n.resolvedLanguage
	const [expanded, setExpanded] = useState(false)
	const [activeKey, setActiveKey] = useState<React.Key>()

	const items = useMemo<NonNullable<SourcesProps['items']>>(
		() =>
			(citations ?? []).map(c => ({
				key: citationKey(c),
				icon: c.data_source_type === 'website_crawl' ? <GlobalOutlined /> : <FileTextOutlined />,
				title: citationTitle(c, language),
			})),
		[citations, language],
	)

	if (!citations?.length) return null
	const active = expanded ? citations.find(c => citationKey(c) === activeKey) : undefined
	return (
		<Flex
			vertical
			gap="small"
		>
			<Sources
				title={t('message.reference.title')}
				items={items}
				expanded={expanded}
				onExpand={setExpanded}
				// Sources also hands `onClick` to its root element (it spreads its other props there), so a click
				// on an item arrives twice, with the item and then with the DOM event, and a click on the title
				// once, with the event. Only an item of this list picks an excerpt.
				onClick={item => {
					if (items.includes(item)) setActiveKey(item.key)
				}}
			/>
			{active && (
				<Card size="small">
					<Typography.Paragraph ellipsis={EXCERPT_ELLIPSIS}>{active.content}</Typography.Paragraph>
					<Flex
						gap="small"
						wrap
					>
						{active.score ? (
							<Tag>
								{t('message.reference.score', { value: formatDecimal(active.score, language, 2) })}
							</Tag>
						) : null}
						{active.hit_count ? (
							<Tag>
								{t('message.reference.hit_count', {
									value: formatCount(active.hit_count, language),
								})}
							</Tag>
						) : null}
						{active.word_count ? (
							<Tag>
								{t('message.reference.word_count', {
									value: formatCount(active.word_count, language),
								})}
							</Tag>
						) : null}
					</Flex>
				</Card>
			)}
		</Flex>
	)
}
