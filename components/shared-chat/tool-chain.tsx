'use client'

import { HourglassOutlined } from '@ant-design/icons'
import { ThoughtChain } from '@ant-design/x'
import type { ThoughtChainItemType } from '@ant-design/x'
import { use, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { ToolPart, ToolStatus } from '@/lib/chat/turn'

import { TurnAnswersContext } from './answer-context'
import ApprovalActions from './approval-actions'
import DecisionNote from './decision-note'
import { toolFooter } from './tool-view-data'
import { toolItemView } from './tool-views'

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

/**
 * Consecutive tool calls as one X ThoughtChain (spec §5.3, the full-stack template's tool card on X's own component,
 * the one the Dify chat uses for agent thoughts). Each item's title, description and body come from the tool's
 * renderer (tool-views.tsx: the generic card, or the hub's `ask_user` view), its status from the part. In the turn that
 * waits (TurnAnswersContext), a call an open approval names carries Approve and Reject in the item's `footer` (spec
 * §6.1), and an open `ask_user` call with drafted answers reads "Answered" with Change (plan call P13); X renders the
 * footer below the collapsible body, always visible (`es/thought-chain/Node.js`). Tool-call ids are unique in a thread
 * (the spike), so an older turn's calls never match an open item.
 */
export default function ToolChain({ tools }: { tools: ToolPart[] }) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	const items = useMemo<ThoughtChainItemType[]>(
		() =>
			tools.map(tool => {
				const view = toolItemView(tool, t)
				const footer = answers ? toolFooter(tool, answers) : null
				return {
					key: tool.toolCallId,
					title: view.title,
					description: view.description,
					status: STATUS[tool.status],
					icon: tool.status === 'waiting' ? <HourglassOutlined /> : undefined,
					blink: tool.status === 'running',
					collapsible: view.collapsible,
					content: view.content,
					footer:
						footer?.kind === 'approval' ? (
							<ApprovalActions interrupt={footer.interrupt} />
						) : footer?.kind === 'answered' ? (
							<DecisionNote
								itemId={tool.toolCallId}
								color="success"
								label={t('shared_chat.answer.answered')}
							/>
						) : undefined,
				}
			}),
		[answers, t, tools],
	)
	return <ThoughtChain items={items} />
}
