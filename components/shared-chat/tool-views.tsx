'use client'

import { CodeHighlighter } from '@ant-design/x'
import type { CodeHighlighterProps } from '@ant-design/x'
import { Descriptions, Flex, Typography, theme } from 'antd'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import {
	askUserView,
	toolDetail,
	toolSummary,
	type AskUserView,
	type ToolDetail,
} from './tool-view-data'
import styles from './tool-views.module.css'

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

/** A part of the card's body that has nothing to show (no result yet, an empty object). */
const EMPTY: ToolDetail = { kind: 'empty' }

/**
 * One part of the card's body as its kind says (tool-view-data.ts `toolDetail`): text as an antd Paragraph keeping its
 * line breaks, a flat object as small, bordered one-column antd Descriptions (`size`, `bordered`, `column`, `styles`:
 * `antd info Descriptions`; bordered, its values line up in one column), and
 * only nested or array JSON in X CodeHighlighter (`lang` "json"; Prism's light mode loads the one `json` grammar, X
 * CodeHighlighter API `prismLightMode`). Every text renders as text, never HTML.
 */
function DetailBody({ detail }: { detail: Exclude<ToolDetail, { kind: 'empty' }> }) {
	const { isDark } = useThemeContext()
	const { token } = theme.useToken()
	// A tighter cell than `size="small"`'s paddingXS × padding, so a short object stays a few slim rows (antd's semantic
	// `styles.label` and `styles.content` land on the bordered cells, `es/descriptions/Cell.js`).
	const cell = { paddingBlock: token.paddingXXS, paddingInline: token.paddingSM }
	switch (detail.kind) {
		case 'text':
			return (
				<Typography.Paragraph
					className={styles.text}
					style={{ marginBottom: 0 }}
				>
					{detail.text}
				</Typography.Paragraph>
			)
		case 'fields':
			return (
				<Descriptions
					size="small"
					bordered
					column={1}
					styles={{ label: cell, content: cell }}
					items={detail.items.map(item => ({
						key: item.key,
						label: item.key,
						children: <span className={styles.text}>{item.value}</span>,
					}))}
				/>
			)
		case 'json':
			return (
				<CodeHighlighter
					lang="json"
					highlightProps={isDark ? DARK_HIGHLIGHT : undefined}
				>
					{detail.text}
				</CodeHighlighter>
			)
		default:
			return detail satisfies never
	}
}

/** A labelled part of the body ("Arguments", "Result"), left out when it has nothing to show. */
function DetailSection({ label, detail }: { label: string; detail: ToolDetail }) {
	const { token } = theme.useToken()
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
			<DetailBody detail={detail} />
		</Flex>
	)
}

/**
 * The generic card's body (spec §5.3; the approved design of 2026-10-15, A.2, after AI Elements' `Tool`, whose
 * arguments and result sit behind the chevron under small labels): the arguments, then the result once there is one.
 */
function ToolCallDetails({ args, result }: { args: ToolDetail; result: ToolDetail }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	return (
		<Flex
			vertical
			gap={token.marginSM}
		>
			<DetailSection
				label={t('shared_chat.tool_arguments')}
				detail={args}
			/>
			<DetailSection
				label={t('shared_chat.tool_result')}
				detail={result}
			/>
		</Flex>
	)
}

/**
 * Any tool: title = its name, description = the summary line (A.1), a collapsible body with the arguments and the
 * result (A.2). A call with nothing in either has no body, so no chevron (X draws it only with `content`,
 * `es/thought-chain/Node.js`).
 */
const genericView = (part: ToolPart): ToolItemView => {
	const args = toolDetail(part.args)
	const result = part.result === undefined ? EMPTY : toolDetail(part.result)
	const empty = args.kind === 'empty' && result.kind === 'empty'
	return {
		title: part.name,
		description: toolSummary(part.args) || undefined,
		collapsible: !empty,
		content: empty ? undefined : (
			<ToolCallDetails
				args={args}
				result={result}
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
