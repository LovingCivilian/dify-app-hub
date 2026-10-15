'use client'

import {
	CheckCircleOutlined,
	ClockCircleOutlined,
	CloseCircleOutlined,
	HourglassOutlined,
	MinusCircleOutlined,
	SyncOutlined,
	ToolOutlined,
} from '@ant-design/icons'
import { Card, Flex } from 'antd'
import type { TagProps } from 'antd'
import { use, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolPart } from '@/lib/chat/turn'

import { TurnAnswersContext } from './answer-context'
import ApprovalActions from './approval-actions'
import ChatCard from './chat-card'
import DecisionNote from './decision-note'
import DecisionReceipt from './decision-receipt'
import {
	approvalView,
	toolBadge,
	toolFooter,
	toolOpenByDefault,
	type ToolBadge,
} from './tool-view-data'
import { toolItemView } from './tool-views'

/**
 * Each status badge's antd Tag (AI Elements' `getStatusBadge`: a pill with an icon and a label; antd Tag's preset status
 * colours `processing`, `success`, `error`, `warning`, `default` with an `icon`, the Tag "status" demo:
 * `antd demo Tag status --version 6.6.5`).
 */
const BADGES = {
	running: {
		color: 'processing',
		icon: <SyncOutlined spin />,
		key: 'shared_chat.tool_status.running',
	},
	waiting: {
		color: 'default',
		icon: <HourglassOutlined />,
		key: 'shared_chat.tool_status.waiting',
	},
	completed: {
		color: 'success',
		icon: <CheckCircleOutlined />,
		key: 'shared_chat.tool_status.completed',
	},
	error: { color: 'error', icon: <CloseCircleOutlined />, key: 'shared_chat.tool_status.error' },
	stopped: {
		color: 'default',
		icon: <MinusCircleOutlined />,
		key: 'shared_chat.tool_status.stopped',
	},
	awaiting_approval: {
		color: 'warning',
		icon: <ClockCircleOutlined />,
		key: 'shared_chat.answer.awaiting_approval',
	},
	expired: { color: 'warning', icon: <ClockCircleOutlined />, key: 'shared_chat.answer.expired' },
} as const satisfies Record<ToolBadge, { color: TagProps['color']; icon: ReactNode; key: string }>

/**
 * One tool call as AI Elements' `Tool` (vercel/ai-elements `packages/elements/src/tool.tsx`; the owner, 2026-10-15:
 * "the way https://elements.ai-sdk.dev/components/tool does it … align with what I had in mind"): the chat's card
 * (chat-card.tsx, whose look this card set), its header the tool's icon, name and status badge, its body the arguments
 * and the result (tool-views.tsx). It starts open as AI Elements' does for a completed or failed tool, and for one that
 * waits for its approval, and opens when its call completes (ChatCard `defaultOpen`). A card with no body is held
 * closed and the hub's `ask_user` card held open, neither with a chevron (ChatCard `fixed`). Inside the card, in the
 * turn that waits (TurnAnswersContext), sits the approval's request with Reject and Approve between the arguments and
 * the result (spec §6.1; AI Elements puts its `Confirmation` there), or "Answered" with Change in the same bordered box
 * under drafted `ask_user` answers, which show beside their questions (plan call P13). Once the approval's answer went,
 * the same place keeps it read-only in the request's bordered box, an antd Card `size="small"` (approval-actions.tsx),
 * after the tool has run too, as AI Elements keeps "✓ Accepted" between the parameters and the result (the owner,
 * 2026-10-15: "record everything that happens in the chat").
 */
function ToolCard({ tool }: { tool: ToolPart }) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	const footer = answers ? toolFooter(tool, answers) : null
	const inner =
		footer?.kind === 'approval' ? (
			<ApprovalActions interrupt={footer.interrupt} />
		) : footer?.kind === 'answered' ? (
			<Card size="small">
				<DecisionNote
					itemId={tool.toolCallId}
					color="success"
					label={t('shared_chat.answer.answered')}
				/>
			</Card>
		) : tool.decision ? (
			<Card size="small">
				<DecisionReceipt mark={tool.decision} />
			</Card>
		) : undefined
	const drafted =
		footer?.kind === 'answered' && answers
			? answers.draft.tools[tool.toolCallId]?.content
			: undefined
	const view = toolItemView(tool, t, { inner, drafted })
	const approval =
		answers && footer?.kind === 'approval' ? approvalView(footer.interrupt, answers) : null
	const badgeKind = toolBadge(tool.status, approval)
	const badge = BADGES[badgeKind]
	const opening = view.alwaysOpen
		? ({ fixed: 'open' } as const)
		: view.content === undefined
			? ({ fixed: 'closed' } as const)
			: { defaultOpen: toolOpenByDefault(badgeKind) }
	return (
		<ChatCard
			{...opening}
			icon={<ToolOutlined />}
			title={view.title}
			badge={{ color: badge.color, icon: badge.icon, label: t(badge.key) }}
		>
			{view.content}
		</ChatCard>
	)
}

/** Consecutive tool calls, one card each (AI Elements renders one `Tool` per tool part). */
export default function ToolChain({ tools }: { tools: ToolPart[] }) {
	return (
		<Flex
			vertical
			gap="small"
		>
			{tools.map(tool => (
				<ToolCard
					key={tool.toolCallId}
					tool={tool}
				/>
			))}
		</Flex>
	)
}
