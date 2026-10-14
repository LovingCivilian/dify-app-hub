'use client'

import { HourglassOutlined } from '@ant-design/icons'
import { CodeHighlighter, ThoughtChain } from '@ant-design/x'
import type { CodeHighlighterProps, ThoughtChainItemType } from '@ant-design/x'
import { Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import type { ToolStatus } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import { inputHint, prettyJson, type ToolPart } from './turn-parts'

/**
 * ThoughtChain's item statuses (X 2.9.0 `es/thought-chain/Status.d.ts`: loading, success, error, abort) for the tool
 * part's (plan calls P9, P10). A waiting call has none of the four: its item shows an hourglass `icon` and no status
 * colour (`es/thought-chain/Status.js` draws a status's own icon when the item has a status, else the item's `icon`;
 * `Node.js` puts the item's number there when it has neither).
 */
const STATUS: Record<ToolStatus, ThoughtChainItemType['status']> = {
	running: 'loading',
	waiting: undefined,
	done: 'success',
	error: 'error',
	stopped: 'abort',
}

// Dark scheme, as the Markdown code block does (components/chat/message/markdown/code-block.tsx): CodeHighlighter
// highlights with Prism's one-light style, and `highlightProps.style` replaces it. A module constant: X memoises on it.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}

/**
 * Consecutive tool calls as one X ThoughtChain (spec §5.3, the full-stack template's tool card on X's own component,
 * the one the Dify chat uses for agent thoughts): each item's title is the tool's name, its description a short input
 * hint, its status the part's, and its collapsible body the arguments and the result in X CodeHighlighter (`lang`
 * "json"; Prism's light mode loads the one `json` grammar, X CodeHighlighter API `prismLightMode`). Every text renders
 * as text, never HTML.
 */
export default function ToolChain({ tools }: { tools: ToolPart[] }) {
	const { t } = useTranslation()
	const { isDark } = useThemeContext()
	const highlight = isDark ? DARK_HIGHLIGHT : undefined
	const items = useMemo<ThoughtChainItemType[]>(
		() =>
			tools.map(tool => ({
				key: tool.toolCallId,
				title: tool.name,
				description: inputHint(tool.args),
				status: STATUS[tool.status],
				icon: tool.status === 'waiting' ? <HourglassOutlined /> : undefined,
				blink: tool.status === 'running',
				collapsible: true,
				content: (
					<Flex
						vertical
						gap="small"
					>
						<Typography.Text type="secondary">{t('shared_chat.tool_arguments')}</Typography.Text>
						<CodeHighlighter
							lang="json"
							highlightProps={highlight}
						>
							{prettyJson(tool.args)}
						</CodeHighlighter>
						{tool.result !== undefined && (
							<>
								<Typography.Text type="secondary">{t('shared_chat.tool_result')}</Typography.Text>
								<CodeHighlighter
									lang="json"
									highlightProps={highlight}
								>
									{prettyJson(tool.result)}
								</CodeHighlighter>
							</>
						)}
					</Flex>
				),
			})),
		[highlight, t, tools],
	)
	return <ThoughtChain items={items} />
}
