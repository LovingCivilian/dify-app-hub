'use client'

import { Alert, Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import MessageMarkdown from '@/components/chat/message/message-markdown'
import Reasoning from '@/components/chat/message/reasoning'
import type { Turn } from '@/lib/chat/turn'

import { runErrorView, stoppedCaptionKey } from './run-error'
import ToolChain from './tool-chain'
import { groupParts } from './turn-parts'

export interface AssistantTurnProps {
	turn: Turn
	/** X's message status: `updating` while the turn streams (spec §5.2: the transport layer). */
	status?: string
}

/**
 * An answer (spec §5.3): its parts in arrival order (reasoning in X Think through the Dify chat's `Reasoning` and its
 * timer, text through `MessageMarkdown`, consecutive tool calls as one ThoughtChain; 2b renders activity parts), then
 * each run's error in an antd Alert below what streamed, then "Stopped" or "Stopped: time limit". An answer that ended
 * with nothing shows the Dify chat's empty-answer warning.
 */
export default function AssistantTurn({ turn, status }: AssistantTurnProps) {
	const { t } = useTranslation()
	const streaming = status === 'updating'
	const groups = useMemo(() => groupParts(turn.parts), [turn.parts])
	const errors = turn.runs.filter(run => run.error)
	const caption = stoppedCaptionKey(turn)
	// An answer that only interrupts (the agent asks and says nothing) is not empty.
	const empty =
		groups.length === 0 && errors.length === 0 && turn.interrupts.length === 0 && !caption
	return (
		<Flex
			vertical
			gap="small"
		>
			{groups.map((group, index) => {
				const last = index === groups.length - 1
				switch (group.kind) {
					case 'reasoning':
						return (
							<Reasoning
								key={group.messageId}
								reasoning={group.text}
								// Done once anything follows it, or the turn stopped streaming.
								done={!streaming || !last}
								streaming={streaming}
								messageId={group.messageId}
							/>
						)
					case 'text':
						return (
							<MessageMarkdown
								key={group.messageId}
								content={group.text}
								streaming={streaming && last}
								messageId={group.messageId}
							/>
						)
					case 'tools':
						return (
							<ToolChain
								key={group.key}
								tools={group.tools}
							/>
						)
					case 'activity':
						// Spec §6.4 (2b): activity cards.
						return null
					default:
						return group satisfies never
				}
			})}
			{errors.map((run, index) => {
				const view = runErrorView(run.error!)
				return (
					<Alert
						key={`${run.runId}:${index}`}
						type="error"
						showIcon
						title={t(view.titleKey)}
						description={view.description}
					/>
				)
			})}
			{caption && <Typography.Text type="secondary">{t(caption)}</Typography.Text>}
			{empty && status === 'success' && (
				<Alert
					type="warning"
					showIcon
					title={t('message.empty_content')}
					description={t('message.empty_content_hint')}
				/>
			)}
		</Flex>
	)
}
