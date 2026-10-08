'use client'

import { Alert, Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import AgentThoughts from '../message/agent-thoughts'
import { displayWorkflow } from '../message/display-workflow'
import MessageFiles from '../message/message-files'
import MessageMarkdown from '../message/message-markdown'
import MessageSources from '../message/message-sources'
import Reasoning from '../message/reasoning'
import WorkflowLogs from '../message/workflow-logs'
import type { DifyChatMessage } from '../provider/message'
import type { BubbleInfo } from './message-list'

export type { BubbleInfo } from './message-list'

export interface AssistantContentProps {
	message: DifyChatMessage
	info: BubbleInfo
	/** Posts a message back from the answer (Dify buttons and forms); left out while a reply streams. */
	onSend?: (text: string) => void
	/** Rendered between the answer and its files (Task 13: the human input form). */
	extra?: React.ReactNode
}

const hasNothingToShow = (m: DifyChatMessage) =>
	!m.content &&
	!m.reasoning &&
	!m.thoughts?.length &&
	!m.workflow?.nodes.length &&
	!m.files?.length &&
	!m.citations?.length &&
	!m.humanInput

/**
 * An assistant bubble's content (spec §5.2), in order: node logs, reasoning, tool calls, the Markdown
 * answer, the form slot, then the error (spec §4.5: a stream error shows in the bubble, below whatever
 * came before it, such as a failed chatflow run's node logs), the "stopped" caption, files and
 * citations. A bubble with nothing but the error is the error alone.
 */
export default function AssistantContent({ message, info, onSend, extra }: AssistantContentProps) {
	const { t } = useTranslation()
	const streaming = info.status === 'updating'
	const { workflow, error, aborted, files } = message
	const shownWorkflow = useMemo(
		() => displayWorkflow({ workflow, error, aborted }),
		[workflow, error, aborted],
	)
	const assistantFiles = useMemo(() => files?.filter(f => f.belongsTo === 'assistant'), [files])
	const empty = hasNothingToShow(message)

	const errorAlert = error ? (
		<Alert
			type="error"
			showIcon
			// Dify's own text, or the generic one when the error came without a message.
			title={error.message || t('common.request_failed_retry')}
			description={error.code}
		/>
	) : null
	if (errorAlert && empty && !extra) return errorAlert

	return (
		<Flex
			vertical
			gap="small"
		>
			{/* The run first, then its reasoning, as Dify's own chat orders them (1.17.1, chat/answer/index.tsx). */}
			<WorkflowLogs workflow={shownWorkflow} />
			{message.reasoning && (
				<Reasoning
					reasoning={message.reasoning}
					done={Boolean(message.reasoningDone) || !streaming}
					streaming={streaming}
					messageId={message.ids.messageId}
				/>
			)}
			<AgentThoughts
				thoughts={message.thoughts}
				streaming={streaming}
				interrupted={aborted ? 'abort' : error ? 'error' : undefined}
			/>
			{message.content && (
				<MessageMarkdown
					content={message.content}
					streaming={streaming}
					messageId={message.ids.messageId}
					onSend={onSend}
				/>
			)}
			{extra}
			{errorAlert}
			{aborted && <Typography.Text type="secondary">{t('chat.stopped')}</Typography.Text>}
			<MessageFiles files={assistantFiles} />
			<MessageSources citations={message.citations} />
			{!error && info.status === 'success' && empty && (
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
