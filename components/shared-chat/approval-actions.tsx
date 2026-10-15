'use client'

import type { Interrupt } from '@ag-ui/core'
import { Button, Card, Flex, Tag, Typography } from 'antd'
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
 * The request inside the gated tool's card, between its arguments and its result (spec §6.1; AI Elements' `Tool` with its
 * `Confirmation` inside the card: a bordered box, the request's text above, Reject then Accept at the end; the owner,
 * 2026-10-15: "the approval should be shown inside the block like how AI Elements does it"). An antd Card (`size="small"`,
 * `antd info Card --version 6.6.5`) holds the interrupt's message as plain text, as the agent sent it (spec §6.4), or "Run
 * this tool?" when it has none, and below it the buttons at the end. The answer follows the interrupt's own
 * `responseSchema` (approvalPayload, plan call P5); an expired approval shows "Expired" with Dismiss only, which answers it
 * `cancelled` (plan call P14); a recorded decision shows its DecisionNote with Change until the last open item has one
 * (plan call P13). Outside a waiting chat it renders nothing.
 */
export default function ApprovalActions({ interrupt }: { interrupt: Interrupt }) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	if (!answers) return null
	const { disabled, answer } = answers
	const view = approvalView(interrupt, answers)
	if (view.kind === 'decided')
		return (
			<Card size="small">
				<DecisionNote
					itemId={interrupt.id}
					color={DECISION_TAGS[view.decision].color}
					label={t(DECISION_TAGS[view.decision].key)}
				/>
			</Card>
		)
	const resolve = (approved: boolean) =>
		answer({
			kind: 'resume',
			interruptId: interrupt.id,
			status: 'resolved',
			payload: approvalPayload(interrupt.responseSchema, approved),
		})
	return (
		<Card size="small">
			<Flex
				vertical
				gap="small"
			>
				<Typography.Paragraph
					type="secondary"
					className={styles.request}
					style={{ marginBottom: 0 }}
				>
					{interrupt.message || t('shared_chat.answer.approval_request')}
				</Typography.Paragraph>
				{view.kind === 'open' ? (
					<Flex
						gap="small"
						justify="end"
						wrap
					>
						<Button
							disabled={disabled}
							onClick={() => resolve(false)}
						>
							{t('shared_chat.answer.reject')}
						</Button>
						<Button
							type="primary"
							disabled={disabled}
							onClick={() => resolve(true)}
						>
							{t('shared_chat.answer.approve')}
						</Button>
					</Flex>
				) : (
					<Flex
						gap="small"
						justify="end"
						align="center"
						wrap
					>
						<Tag color="warning">{t('shared_chat.answer.expired')}</Tag>
						<Button
							disabled={disabled}
							onClick={() =>
								answer({ kind: 'resume', interruptId: interrupt.id, status: 'cancelled' })
							}
						>
							{t('shared_chat.answer.dismiss')}
						</Button>
					</Flex>
				)}
			</Flex>
		</Card>
	)
}
