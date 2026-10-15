'use client'

import { CodeHighlighter } from '@ant-design/x'
import type { CodeHighlighterProps } from '@ant-design/x'
import { Flex, Typography, theme } from 'antd'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { useThemeContext } from '@/lib/theme'

import type { ToolDetail } from './tool-view-data'

// Dark scheme, as the Markdown code block does (components/chat/message/markdown/code-block.tsx): CodeHighlighter
// highlights with Prism's one-light style, and `highlightProps.style` replaces it. A module constant: X memoises on it.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}

/**
 * A code block of the shared chat's cards ("Arguments", "Result", a form's sent values), left out when it has nothing to
 * show: an optional small secondary label over X CodeHighlighter as it ships, its header ("json" or "markdown" and copy)
 * included (AI Elements' `ToolInput` and `ToolOutput`: a small label over a code block; X CodeHighlighter API `lang`,
 * `children`, `highlightProps`; `lang`: Prism's light mode loads only that grammar, `prismLightMode`). Every text goes
 * into the code block as text, never HTML.
 */
export default function CodeSection({ label, detail }: { label?: string; detail: ToolDetail }) {
	const { token } = theme.useToken()
	const { isDark } = useThemeContext()
	if (detail.kind === 'empty') return null
	return (
		<Flex
			vertical
			gap={token.marginXXS}
		>
			{label && (
				<Typography.Text
					type="secondary"
					style={{ fontSize: token.fontSizeSM }}
				>
					{label}
				</Typography.Text>
			)}
			<CodeHighlighter
				lang={detail.lang}
				highlightProps={isDark ? DARK_HIGHLIGHT : undefined}
			>
				{detail.code}
			</CodeHighlighter>
		</Flex>
	)
}
