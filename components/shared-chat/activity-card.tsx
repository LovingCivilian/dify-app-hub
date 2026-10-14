'use client'

import { CodeHighlighter } from '@ant-design/x'
import type { CodeHighlighterProps } from '@ant-design/x'
import { Card, Collapse, Descriptions, Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import type { TurnPart } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import { activityView } from './activity-view'

// Dark scheme, as the tool card and the Markdown code block do (`tool-chain.tsx`, `markdown/code-block.tsx`):
// `highlightProps.style` replaces Prism's one-light style. A module constant: X memoises on it.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}

/**
 * An `activity` part, read-only in the turn (spec §6.4, plan call P17): a small antd Card titled with its
 * `activityType` (AG-UI 1.0 spec, Events › Activity: an open string, and "a consumer MUST tolerate types it does not
 * recognise"), a flat `content` as antd Descriptions, anything else as indented JSON in X CodeHighlighter inside a
 * closed ghost Collapse, cut at 10 KB with a note (`activityView`). Keys, values and the type render as text nodes,
 * never HTML.
 */
export default function ActivityCard({ part }: { part: Extract<TurnPart, { kind: 'activity' }> }) {
	const { t } = useTranslation()
	const { isDark } = useThemeContext()
	const view = useMemo(() => activityView(part.content), [part.content])
	return (
		<Card
			size="small"
			title={part.activityType}
		>
			{view.kind === 'fields' ? (
				<Descriptions
					size="small"
					column={1}
					items={view.items.map(item => ({ key: item.key, label: item.key, children: item.value }))}
				/>
			) : (
				<Collapse
					ghost
					items={[
						{
							key: 'content',
							label: t('shared_chat.activity.content'),
							children: (
								<Flex
									vertical
									gap="small"
								>
									<CodeHighlighter
										lang="json"
										highlightProps={isDark ? DARK_HIGHLIGHT : undefined}
									>
										{view.text}
									</CodeHighlighter>
									{view.truncated && (
										<Typography.Text type="secondary">
											{t('shared_chat.activity.truncated')}
										</Typography.Text>
									)}
								</Flex>
							),
						},
					]}
				/>
			)}
		</Card>
	)
}
