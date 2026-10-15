'use client'

import { Alert, Card, Descriptions, Flex, Typography, theme } from 'antd'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ASK_USER_TOOL_NAME, type AskUserAnswer } from '@/lib/chat/ask-user'
import type { ToolPart } from '@/lib/chat/turn'

import CodeSection from './code-section'
import DecisionReceipt from './decision-receipt'
import { askUserView, toolDetail, type AskUserView, type ToolDetail } from './tool-view-data'
import styles from './tool-views.module.css'

/** What a tool's card shows (tool-chain.tsx draws the card): its title, and its body, if any. */
export interface ToolItemView {
	title: ReactNode
	content?: ReactNode
	/** The body is always in view, never behind the chevron (the hub's own `ask_user` card). */
	alwaysOpen?: boolean
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

/** What the turn that waits adds to a tool's card (tool-chain.tsx). */
export interface ToolItemExtras {
	/** Inside the card: an approval, a decision, "Answered" with Change. */
	inner?: ReactNode
	/** The transcript of an `ask_user` call's answers waiting in the draft (plan call P13). */
	drafted?: string
}

/**
 * Any tool: title = its name, and a body with its arguments, its approval (`inner`, tool-chain.tsx), its result and its
 * error. A call with nothing in any of them has no body, so its card has no chevron.
 */
const genericView = (part: ToolPart, { inner }: ToolItemExtras): ToolItemView => {
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

/** An answer as it went: its text, or "Skipped" and "No answer" in secondary text for the transcript's markers. */
const answerText = ({ answer, skipped }: AskUserAnswer, t: TFunction): ReactNode =>
	skipped || !answer ? (
		<Typography.Text type="secondary">
			{t(skipped ? 'shared_chat.ask_user.skipped' : 'shared_chat.ask_user.no_answer')}
		</Typography.Text>
	) : (
		<span className={styles.lines}>{answer}</span>
	)

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
						<Typography.Text
							key={index}
							className={styles.lines}
						>
							{question}
						</Typography.Text>
					))}
				</Flex>
			)
		case 'answers':
			// Each question over its answer, with no border, as an answered form's values (antd Descriptions `layout`
			// "vertical", `colon` false: a question ends with its own mark; `antd info Descriptions --version 6.6.5`).
			return (
				<Descriptions
					size="small"
					column={1}
					layout="vertical"
					colon={false}
					items={view.answers.map(({ question, answer }, index) => ({
						key: index,
						label: <span className={styles.lines}>{question}</span>,
						children: answerText(answer, t),
					}))}
				/>
			)
		case 'transcript':
			return <Typography.Text className={styles.lines}>{view.text}</Typography.Text>
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
 * questions and answers"; the template's `AskUserResult`): always open, so the questions, or each question with its
 * answer, are always in view, as an interrupt card's are (the owner, 2026-10-15: the content without a border, and the
 * box only around the choice): below them "Answered" and Change (`inner`) while the answers wait to go, and once they
 * went the receipt "Answered" in the same bordered box (an antd Card `size="small"`). The card that answers it sits
 * above the composer (ask-user-card.tsx).
 */
/** The `ask_user` card's body: its content, then its box, at the tool card's spacing between sections. */
function AskUserDetails({ content, box }: { content: ReactNode; box: ReactNode }) {
	const { token } = theme.useToken()
	return (
		<Flex
			vertical
			gap={token.marginSM}
		>
			{content}
			{box}
		</Flex>
	)
}

const askUserItemView = (
	part: ToolPart,
	t: TFunction,
	{ inner, drafted }: ToolItemExtras,
): ToolItemView => {
	const view = askUserView(part, drafted)
	const content = askUserContent(view, t)
	const box =
		inner ??
		(view.kind === 'answers' && part.status === 'done' ? (
			<Card size="small">
				<DecisionReceipt mark="answered" />
			</Card>
		) : undefined)
	return {
		title: t('shared_chat.ask_user.title'),
		content:
			content && box ? (
				<AskUserDetails
					content={content}
					box={box}
				/>
			) : (
				(content ?? box)
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
	(part: ToolPart, t: TFunction, extras: ToolItemExtras) => ToolItemView
>([[ASK_USER_TOOL_NAME, askUserItemView]])

/** The card's view, with what the turn that waits adds to it (`extras`). */
export const toolItemView = (
	part: ToolPart,
	t: TFunction,
	extras: ToolItemExtras = {},
): ToolItemView => TOOL_VIEWS.get(part.name)?.(part, t, extras) ?? genericView(part, extras)
