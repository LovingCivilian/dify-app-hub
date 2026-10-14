'use client'

import type { Interrupt } from '@ag-ui/core'
import { Button, Flex, Tag, Typography } from 'antd'
import { use } from 'react'
import { useTranslation } from 'react-i18next'

import { approvalPayload } from '@/lib/chat/interrupt-answers'

import { TurnAnswersContext } from './answer-context'
import DecisionNote from './decision-note'
import { approvalView, type ApprovalDecision } from './tool-view-data'

/** A recorded decision's Tag (antd Tag `color`: the preset status colours `success`, `error`, `default`). */
const DECISION_TAGS = {
	approved: { color: 'success', key: 'shared_chat.answer.approved' },
	rejected: { color: 'error', key: 'shared_chat.answer.rejected' },
	cancelled: { color: 'default', key: 'shared_chat.answer.cancelled' },
} as const satisfies Record<ApprovalDecision, { color: string; key: string }>

/**
 * Approve and Reject on the gated tool's ThoughtChain item (spec §6.1), with the arguments read-only in the item above
 * (agenticos's rule). The interrupt's message renders as text (spec §6.4). The answer follows the interrupt's own
 * `responseSchema` (approvalPayload, plan call P5); an expired approval offers Dismiss only, which answers it
 * `cancelled` (plan call P14); a recorded decision shows as a DecisionNote with Change until the last open item has one
 * (plan call P13). Outside a waiting chat it renders nothing.
 */
export default function ApprovalActions({ interrupt }: { interrupt: Interrupt }) {
	const { t } = useTranslation()
	const answers = use(TurnAnswersContext)
	if (!answers) return null
	const { disabled, answer } = answers
	const view = approvalView(interrupt, answers)
	const resolve = (approved: boolean) =>
		answer({
			kind: 'resume',
			interruptId: interrupt.id,
			status: 'resolved',
			payload: approvalPayload(interrupt.responseSchema, approved),
		})
	return (
		<Flex
			vertical
			gap="small"
		>
			{interrupt.message && <Typography.Text>{interrupt.message}</Typography.Text>}
			{view.kind === 'open' && (
				<Flex
					wrap
					gap="small"
				>
					<Button
						type="primary"
						size="small"
						disabled={disabled}
						onClick={() => resolve(true)}
					>
						{t('shared_chat.answer.approve')}
					</Button>
					<Button
						size="small"
						disabled={disabled}
						onClick={() => resolve(false)}
					>
						{t('shared_chat.answer.reject')}
					</Button>
				</Flex>
			)}
			{view.kind === 'expired' && (
				<Flex
					wrap
					gap="small"
					align="center"
				>
					<Tag color="warning">{t('shared_chat.answer.expired')}</Tag>
					<Button
						size="small"
						disabled={disabled}
						onClick={() =>
							answer({ kind: 'resume', interruptId: interrupt.id, status: 'cancelled' })
						}
					>
						{t('shared_chat.answer.dismiss')}
					</Button>
				</Flex>
			)}
			{view.kind === 'decided' && (
				<DecisionNote
					itemId={interrupt.id}
					color={DECISION_TAGS[view.decision].color}
					label={t(DECISION_TAGS[view.decision].key)}
				/>
			)}
		</Flex>
	)
}
