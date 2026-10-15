'use client'

import { CodeHighlighter } from '@ant-design/x'
import type { CodeHighlighterProps } from '@ant-design/x'
import { Alert, Flex, Typography, theme } from 'antd'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import { askUserView, toolDetail, type AskUserView, type ToolDetail } from './tool-view-data'
import styles from './tool-views.module.css'

/** What a tool's card shows (tool-chain.tsx draws the card): its title, and its body, if any. */
export interface ToolItemView {
	title: ReactNode
	content?: ReactNode
	/** The body is always in view, never behind the chevron (the hub's own `ask_user` card). */
	alwaysOpen?: boolean
}

// Dark scheme, as the Markdown code block does (components/chat/message/markdown/code-block.tsx): CodeHighlighter
// highlights with Prism's one-light style, and `highlightProps.style` replaces it. A module constant: X memoises on it.
const DARK_HIGHLIGHT: CodeHighlighterProps['highlightProps'] = {
	style: oneDark,
	customStyle: { margin: 0 },
}

/**
 * One labelled part of the body ("Arguments", "Result"), left out when it has nothing to show: a small secondary label
 * over X CodeHighlighter as it ships, its header ("json" or "markdown" and copy) included (AI Elements' `ToolInput` and
 * `ToolOutput`: a small label over a code block; `lang`: Prism's light mode loads only that grammar, X CodeHighlighter API
 * `prismLightMode`). Every text goes into the code block as text, never HTML.
 */
function CodeSection({ label, detail }: { label: string; detail: ToolDetail }) {
	const { token } = theme.useToken()
	const { isDark } = useThemeContext()
	if (detail.kind === 'empty') return null
	return (
		<Flex
			vertical
			gap={token.marginXXS}
		>
			<Typography.Text
				type="secondary"
				style={{ fontSize: token.fontSizeSM }}
			>
				{label}
			</Typography.Text>
			<CodeHighlighter
				lang={detail.lang}
				highlightProps={isDark ? DARK_HIGHLIGHT : undefined}
			>
				{detail.code}
			</CodeHighlighter>
		</Flex>
	)
}

/**
 * The generic card's body (AI Elements' `ToolContent`: the parameters, its `Confirmation` when the call waits for one,
 * then the result or the error): the arguments and the result as code blocks, the approval between them, and a call's
 * error in an antd Alert (`type="error"`, `showIcon`, `title`: `antd info Alert
 * --version 6.6.5`; AI Elements tints its error output red), its text as sent.
 */
function ToolCallDetails({
	args,
	approval,
	result,
	error,
}: {
	args: ToolDetail
	approval?: ReactNode
	result: ToolDetail
	error?: string
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	return (
		<Flex
			vertical
			gap={token.marginSM}
		>
			<CodeSection
				label={t('shared_chat.tool_arguments')}
				detail={args}
			/>
			{approval}
			<CodeSection
				label={t('shared_chat.tool_result')}
				detail={result}
			/>
			{error && (
				<Alert
					type="error"
					showIcon
					title={error}
				/>
			)}
		</Flex>
	)
}

const EMPTY: ToolDetail = { kind: 'empty' }

/**
 * Any tool: title = its name, and a body with its arguments, its approval (`inner`, tool-chain.tsx), its result and its
 * error. A call with nothing in any of them has no body, so its card has no chevron.
 */
const genericView = (part: ToolPart, inner?: ReactNode): ToolItemView => {
	const args = toolDetail(part.args)
	const result = part.result === undefined ? EMPTY : toolDetail(part.result)
	const empty = args.kind === 'empty' && result.kind === 'empty' && !part.error && !inner
	return {
		title: part.name,
		content: empty ? undefined : (
			<ToolCallDetails
				args={args}
				approval={inner}
				result={result}
				error={part.error}
			/>
		),
	}
}

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
 * questions and answers"; the template's `AskUserResult`): always open, so the questions, or the transcript once
 * answered, are always in view, with "Answered" and Change (`inner`) below them while the answers wait to go. The card
 * that answers it sits above the composer (ask-user-card.tsx).
 */
const askUserItemView = (part: ToolPart, t: TFunction, inner?: ReactNode): ToolItemView => {
	const content = askUserContent(askUserView(part), t)
	return {
		title: t('shared_chat.ask_user.title'),
		content:
			content && inner ? (
				<Flex
					vertical
					gap="small"
				>
					{content}
					{inner}
				</Flex>
			) : (
				(content ?? inner)
			),
		alwaysOpen: true,
	}
}

/**
 * Spec §5.3: renderers are looked up by tool name with the generic card as the fallback (assistant-ui, CopilotKit,
 * TanStack AI and X's demo all do; `part2-x-mapping.md` §3.5); `ask_user` is the first. A Map, so a tool named like an
 * object's own property (`constructor`) still gets the generic card.
 */
const TOOL_VIEWS = new Map<
	string,
	(part: ToolPart, t: TFunction, inner?: ReactNode) => ToolItemView
>([[ASK_USER_TOOL_NAME, askUserItemView]])

/** The card's view; `inner` is what the turn that waits adds inside the card (an approval, "Answered" with Change). */
export const toolItemView = (part: ToolPart, t: TFunction, inner?: ReactNode): ToolItemView =>
	TOOL_VIEWS.get(part.name)?.(part, t, inner) ?? genericView(part, inner)
