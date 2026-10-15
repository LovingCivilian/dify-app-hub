'use client'

import { CodeHighlighter } from '@ant-design/x'
import type { CodeHighlighterProps } from '@ant-design/x'
import { Flex, Radio, Table, Typography, theme } from 'antd'
import type { TableColumnsType } from 'antd'
import type { TFunction } from 'i18next'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { ASK_USER_TOOL_NAME } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'
import { useThemeContext } from '@/lib/theme'

import type { JsonRow } from './json-tree'
import { askUserView, toolDetail, type AskUserView, type ToolDetail } from './tool-view-data'
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

/** What a section with JSON shows: the tree table, or the indented JSON (its "Show JSON" toggle). */
type DetailView = 'table' | 'json'

/**
 * The tree table's two columns, name and value (no header: `showHeader={false}`). A row's own expand arrow and indent sit
 * in the first column (antd Table "Tree data"). Names and values are text nodes in Typography.Text, whose `word-break:
 * break-word` lets a long value wrap inside the card (`es/typography/style/index.js`); a branch's preview (`{a, b}`,
 * `[n]`) is secondary text, so it does not read as a string value.
 */
const COLUMNS: TableColumnsType<JsonRow> = [
	{
		key: 'name',
		dataIndex: 'name',
		render: (name: JsonRow['name']) => <Typography.Text type="secondary">{name}</Typography.Text>,
	},
	{
		key: 'value',
		dataIndex: 'value',
		render: (value: string, row) =>
			row.children ? (
				<Typography.Text type="secondary">{value}</Typography.Text>
			) : (
				<Typography.Text className={styles.text}>{value}</Typography.Text>
			),
	},
]

/**
 * A JSON object or array as one small, bordered antd Table with tree data, antd's defaults otherwise (json-tree brief,
 * item 1; `size`, `bordered`, `showHeader`, `pagination`: `antd info Table --version 6.6.5`; the owner, 2026-10-15: "keep
 * it default ant design, no hacks and workarounds"): a nested object or array is a row with `children`, which the Table
 * shows collapsed behind its own expand arrow (`expandable.defaultExpandAllRows` is false); a flat object has no
 * `children`, so no arrows and no indent. No header (the columns have no titles) and no pagination (every row of the
 * value is shown).
 */
function JsonTable({ rows }: { rows: JsonRow[] }) {
	return (
		<Table<JsonRow>
			size="small"
			bordered
			showHeader={false}
			pagination={false}
			columns={COLUMNS}
			dataSource={rows}
		/>
	)
}

/**
 * The JSON view: X CodeHighlighter as it ships, its header ("json" and copy) included (`lang` "json"; Prism's light mode
 * loads the one `json` grammar, X CodeHighlighter API `prismLightMode`; the owner, 2026-10-15: "keep it default ant
 * design"). Dark mode swaps the style as the Markdown code block does.
 */
function JsonCode({ json }: { json: string }) {
	const { isDark } = useThemeContext()
	return (
		<CodeHighlighter
			lang="json"
			highlightProps={isDark ? DARK_HIGHLIGHT : undefined}
		>
			{json}
		</CodeHighlighter>
	)
}

/**
 * One part of the card's body as its kind says (tool-view-data.ts `toolDetail`): text as an antd Paragraph keeping its
 * line breaks, and JSON as the tree table or, once its toggle says so, as indented JSON. Every text renders as text,
 * never HTML.
 */
function DetailBody({
	detail,
	view,
}: {
	detail: Exclude<ToolDetail, { kind: 'empty' }>
	view: DetailView
}) {
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
		case 'tree':
			return view === 'json' ? <JsonCode json={detail.json} /> : <JsonTable rows={detail.rows} />
		default:
			return detail satisfies never
	}
}

/**
 * A labelled part of the body ("Arguments", "Result"), left out when it has nothing to show. A part with JSON carries,
 * beside its label, a small antd Radio.Group drawn as two joined buttons, the selected one filled (`optionType="button"`,
 * `buttonStyle="solid"`, `size`, `options`, `value`, `onChange`: `antd info Radio --version 6.6.5`, the "radiobutton-solid"
 * demo; the owner, 2026-10-15: "two buttons that are joined and switch which one is selected"). The group is a
 * `radiogroup` named by the label (antd `es/radio/group.js` passes `aria-*` through `pickAttrs`); its state is the
 * section's own and starts at the table (json-tree brief, item 2).
 */
function DetailSection({ label, detail }: { label: string; detail: ToolDetail }) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [view, setView] = useState<DetailView>('table')
	if (detail.kind === 'empty') return null
	return (
		<Flex
			vertical
			gap={token.marginXXS}
		>
			<Flex
				justify="space-between"
				align="center"
				gap={token.marginXS}
			>
				<Typography.Text
					type="secondary"
					style={{ fontSize: token.fontSizeSM }}
				>
					{label}
				</Typography.Text>
				{detail.kind === 'tree' && (
					<Radio.Group
						optionType="button"
						buttonStyle="solid"
						size="small"
						aria-label={label}
						value={view}
						// antd types the event's value as `any` (es/radio/interface.d.ts); read it back to the two views.
						onChange={event => setView(event.target.value === 'json' ? 'json' : 'table')}
						options={[
							{ value: 'table', label: t('shared_chat.tool_view_table') },
							{ value: 'json', label: t('shared_chat.tool_view_json') },
						]}
					/>
				)}
			</Flex>
			<DetailBody
				detail={detail}
				view={view}
			/>
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
 * Any tool: title = its name and a collapsible body with the arguments and the result (A.2); no line under the name
 * (the owner, 2026-10-15: "remove the subtitle under the tool call"). A call with nothing in either has no body, so no
 * chevron (X draws it only with `content`, `es/thought-chain/Node.js`).
 */
const genericView = (part: ToolPart): ToolItemView => {
	const args = toolDetail(part.args)
	const result = part.result === undefined ? EMPTY : toolDetail(part.result)
	const empty = args.kind === 'empty' && result.kind === 'empty'
	return {
		title: part.name,
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
