'use client'

import { CodeHighlighter } from '@ant-design/x'
import type { CodeHighlighterProps } from '@ant-design/x'
import { Flex, Typography } from 'antd'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import { askUserView, type AskUserView } from './tool-view-data'
import styles from './tool-views.module.css'
import { inputHint, prettyJson } from './turn-parts'

/** One ThoughtChain item's own fields (X 2.9.0 `ThoughtChainItemType`); the chain adds the key, status and footer. */
export interface ToolItemView {
	title: ReactNode
	description?: ReactNode
	content?: ReactNode
	collapsible: boolean
}

// Dark scheme, as the Markdown code block does (components/chat/message/markdown/code-block.tsx): CodeHighlighter
// highlights with Prism's one-light style, and `highlightProps.style` replaces it. A module constant: X memoises on it.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}

/**
 * The generic card's body (spec §5.3, the full-stack template's tool card on X's own component): the arguments and the
 * result in X CodeHighlighter (`lang` "json"; Prism's light mode loads the one `json` grammar, X CodeHighlighter API
 * `prismLightMode`). Every text renders as text, never HTML.
 */
function ToolCallDetails({ args, result }: { args: string; result?: string }) {
	const { t } = useTranslation()
	const { isDark } = useThemeContext()
	const highlight = isDark ? DARK_HIGHLIGHT : undefined
	return (
		<Flex
			vertical
			gap="small"
		>
			<Typography.Text type="secondary">{t('shared_chat.tool_arguments')}</Typography.Text>
			<CodeHighlighter
				lang="json"
				highlightProps={highlight}
			>
				{prettyJson(args)}
			</CodeHighlighter>
			{result !== undefined && (
				<>
					<Typography.Text type="secondary">{t('shared_chat.tool_result')}</Typography.Text>
					<CodeHighlighter
						lang="json"
						highlightProps={highlight}
					>
						{prettyJson(result)}
					</CodeHighlighter>
				</>
			)}
		</Flex>
	)
}

/** Any tool: title = its name, description = a short input hint, a collapsible body with the arguments and the result. */
const genericView = (part: ToolPart): ToolItemView => ({
	title: part.name,
	description: inputHint(part.args),
	collapsible: true,
	content: (
		<ToolCallDetails
			args={part.args}
			result={part.result}
		/>
	),
})

const askUserContent = (view: AskUserView, t: TFunction): ReactNode => {
	switch (view.kind) {
		case 'pending':
			return undefined
		case 'questions':
			return (
				<Flex
					vertical
					gap="small"
				>
					{view.questions.map((question, index) => (
						<Typography.Text key={index}>{question}</Typography.Text>
					))}
				</Flex>
			)
		case 'transcript':
			return <Typography.Text className={styles.transcript}>{view.text}</Typography.Text>
		case 'invalid':
			return <Typography.Text type="secondary">{t('shared_chat.ask_user.invalid')}</Typography.Text>
		case 'error':
			return <Typography.Text type="danger">{view.text}</Typography.Text>
		default:
			return view satisfies never
	}
}

/**
 * The hub's own `ask_user` tool in the turn (spec §6.2: "Afterwards the ask_user card in the transcript shows the
 * questions and answers"; the template's `AskUserResult`): not collapsible, so the questions, or the transcript once
 * answered, are always in view. The card that answers it sits above the composer (ask-user-card.tsx).
 */
const askUserItemView = (part: ToolPart, t: TFunction): ToolItemView => ({
	title: t('shared_chat.ask_user.title'),
	collapsible: false,
	content: askUserContent(askUserView(part), t),
})

/**
 * Spec §5.3: renderers are looked up by tool name with the generic card as the fallback (assistant-ui, CopilotKit,
 * TanStack AI and X's demo all do; `part2-x-mapping.md` §3.5); `ask_user` is the first. A Map, so a tool named like an
 * object's own property (`constructor`) still gets the generic card.
 */
const TOOL_VIEWS = new Map<string, (part: ToolPart, t: TFunction) => ToolItemView>([
	[ASK_USER_TOOL_NAME, askUserItemView],
])

export const toolItemView = (part: ToolPart, t: TFunction): ToolItemView =>
	TOOL_VIEWS.get(part.name)?.(part, t) ?? genericView(part)
