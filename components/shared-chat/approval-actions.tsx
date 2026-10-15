'use client'

import type { Interrupt } from '@ag-ui/core'
import { Alert, Button, Flex } from 'antd'
import { use } from 'react'
import { useTranslation } from 'react-i18next'

import { approvalPayload } from '@/lib/chat/interrupt-answers'

import { TurnAnswersContext } from './answer-context'
import styles from './approval-actions.module.css'
import DecisionNote from './decision-note'
import { approvalView, type ApprovalDecision } from './tool-view-data'

/** A recorded decision's Tag (antd Tag `color`: the preset status colours `success`, `error`, `default`). */
const DECISION_TAGS = {
	approved: { color: 'success', key: 'shared_chat.answer.approved' },
	rejected: { color: 'error', key: 'shared_chat.answer.rejected' },
	cancelled: { color: 'default', key: 'shared_chat.answer.cancelled' },
} as const satisfies Record<ApprovalDecision, { color: string; key: string }>

/**
 * The request on the gated tool's ThoughtChain item (spec §6.1; the approved design of 2026-10-15, B.2–B.4, after AI
 * Elements' `Confirmation`: a slim alert with the request and small buttons at its end, Reject then Approve), with the
 * arguments read-only in the item above (agenticos's rule). An antd Alert (`antd info Alert`: `title`, which replaces
 * the deprecated `message`; `action`; `showIcon`; `type`) carries the interrupt's message as plain text, as the agent
 * sent it (spec §6.4), or "Run this tool?" when it has none; its `actions` slot sits at the alert's end and the text
 * wraps beside it (antd `es/alert/style/index.js`: the section is `flex: 1; min-width: 0`), or, on a phone, above it
 * (approval-actions.module.css, through the semantic `classNames`: `antd semantic Alert`). The answer follows the
 * interrupt's own `responseSchema` (approvalPayload, plan call P5); an expired approval is a warning with Dismiss only,
 * which answers it `cancelled` (plan call P14); a recorded decision gives way to a DecisionNote with Change until the
 * last open item has one (plan call P13). Outside a waiting chat it renders nothing.
 */
export default function ApprovalActions({ interrupt }: { interrupt: Interrupt }) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	if (!answers) return null
	const { disabled, answer } = answers
	const view = approvalView(interrupt, answers)
	if (view.kind === 'decided')
		return (
			<DecisionNote
				itemId={interrupt.id}
				color={DECISION_TAGS[view.decision].color}
				label={t(DECISION_TAGS[view.decision].key)}
			/>
		)
	const resolve = (approved: boolean) =>
		answer({
			kind: 'resume',
			interruptId: interrupt.id,
			status: 'resolved',
			payload: approvalPayload(interrupt.responseSchema, approved),
		})
	return (
		<Alert
			type={view.kind === 'open' ? 'info' : 'warning'}
			showIcon
			title={interrupt.message || t('shared_chat.answer.approval_request')}
			classNames={{ root: styles.approval, title: styles.request, actions: styles.actions }}
			action={
				view.kind === 'open' ? (
					<Flex
						gap="small"
						justify="end"
					>
						<Button
							size="small"
							disabled={disabled}
							onClick={() => resolve(false)}
						>
							{t('shared_chat.answer.reject')}
						</Button>
						<Button
							type="primary"
							size="small"
							disabled={disabled}
							onClick={() => resolve(true)}
						>
							{t('shared_chat.answer.approve')}
						</Button>
					</Flex>
				) : (
					<Button
						size="small"
						disabled={disabled}
						onClick={() =>
							answer({ kind: 'resume', interruptId: interrupt.id, status: 'cancelled' })
						}
					>
						{t('shared_chat.answer.dismiss')}
					</Button>
				)
			}
		/>
	)
}
