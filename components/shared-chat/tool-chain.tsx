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
import { Collapse, Flex, Tag, Typography } from 'antd'
import type { TagProps } from 'antd'
import { use, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolPart } from '@/lib/chat/turn'

import { TurnAnswersContext } from './answer-context'
import ApprovalActions from './approval-actions'
import DecisionNote from './decision-note'
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
 * "the way https://elements.ai-sdk.dev/components/tool does it … align with what I had in mind"): a bordered, rounded
 * card that opens and closes, an antd Collapse with one panel (`size`, `expandIconPlacement`, `items`, `activeKey`,
 * `defaultActiveKey`, item `showArrow`: `antd info Collapse --version 6.6.5`), its header the tool's icon, name and status
 * badge, its body the arguments and the result (tool-views.tsx). It starts open as AI Elements' does for a completed or
 * failed tool, and for one that waits for its approval; the card is keyed by that, so it opens when its call completes
 * (React: resetting state with a key). A card with no body has no chevron; the hub's `ask_user` card stays open. Below
 * the card, in the turn that waits (TurnAnswersContext), sits the approval's request with Reject and Approve (spec §6.1,
 * AI Elements' separate `Confirmation`), or "Answered" with Change for drafted `ask_user` answers (plan call P13).
 */
function ToolCard({ tool }: { tool: ToolPart }) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	const view = toolItemView(tool, t)
	const footer = answers ? toolFooter(tool, answers) : null
	const approval =
		answers && footer?.kind === 'approval' ? approvalView(footer.interrupt, answers) : null
	const badgeKind = toolBadge(tool.status, approval)
	const badge = BADGES[badgeKind]
	const open = view.alwaysOpen || (view.content !== undefined && toolOpenByDefault(badgeKind))
	const fixed = view.alwaysOpen || view.content === undefined
	return (
		<Flex
			vertical
			gap="small"
		>
			<Collapse
				key={open ? 'open' : 'closed'}
				size="small"
				expandIconPlacement="end"
				// A card without a body, or the `ask_user` card, is held open or closed through the controlled `activeKey`
				// with no `onChange`, and shows no arrow (antd: "If false, panel will not show arrow icon").
				{...(fixed
					? { activeKey: view.alwaysOpen ? [tool.toolCallId] : [] }
					: { defaultActiveKey: open ? [tool.toolCallId] : [] })}
				items={[
					{
						key: tool.toolCallId,
						showArrow: !fixed,
						label: (
							<Flex
								align="center"
								gap="small"
								wrap
							>
								<ToolOutlined />
								<Typography.Text strong>{view.title}</Typography.Text>
								<Tag
									color={badge.color}
									icon={badge.icon}
								>
									{t(badge.key)}
								</Tag>
							</Flex>
						),
						children: view.content,
					},
				]}
			/>
			{footer?.kind === 'approval' ? (
				<ApprovalActions interrupt={footer.interrupt} />
			) : footer?.kind === 'answered' ? (
				<DecisionNote
					itemId={tool.toolCallId}
					color="success"
					label={t('shared_chat.answer.answered')}
				/>
			) : null}
		</Flex>
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
