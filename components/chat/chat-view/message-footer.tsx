'use client'

import {
	DislikeFilled,
	DislikeOutlined,
	EditOutlined,
	LikeFilled,
	LikeOutlined,
	RedoOutlined,
} from '@ant-design/icons'
import { Actions, type ActionsProps } from '@ant-design/x'
import { App, Button, Flex, Typography, theme } from 'antd'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatDateTime } from '@/libs/format-date'

import { useAppContext } from '../app-context'
import { useTts } from '../hooks/use-tts'
import type { DifyRequestError } from '../provider/dify-fetch'
import type { DifyChatMessage } from '../provider/message'
import DislikePopover from './dislike-popover'
import { footerActions } from './message-actions'

export type FeedbackRating = 'like' | 'dislike' | null

export interface MessageFooterProps {
	message: DifyChatMessage
	/** The bubble's key (the SDK message id) and status, from Bubble's slot info. */
	messageKey: string | number
	status?: string
	/** A user turn precedes the answer, so regenerate has a question to ask again. */
	hasQuestion: boolean
	/** A reply is running in this conversation: what acts on the conversation or on Dify's record waits. */
	disabled: boolean
	/** Asks the question this answer replies to again, as a new turn (spec §4.7). */
	onRegenerate: (key: string | number) => void
	/** Rates the answer (Dify's message id), `null` taking a rating back; reports its own failure. */
	onFeedback: (
		key: string | number,
		message: DifyChatMessage,
		rating: FeedbackRating,
		reason?: string,
	) => Promise<void>
	/** Opens the annotation drawer for this answer and its question. */
	onAnnotate: (key: string | number) => void
}

/**
 * An assistant bubble's footer (spec §5.2): X `Actions` with regenerate, `Actions.Copy`, annotate, like and
 * dislike, and `Actions.Audio`, and the creation time in the active language. Which actions show is
 * `footerActions`. Like and dislike are antd Buttons rendered through `actionRender` rather than X's
 * `Actions.Feedback`, whose choices are spans no keyboard reaches and only the icons' English labels name
 * (ADR-0014; ADR-0017 note). The callbacks are the chat view's stable ones, so a bubble whose message did
 * not change keeps its footer while another one streams (memo).
 */
function MessageFooter({
	message,
	messageKey,
	status,
	hasQuestion,
	disabled,
	onRegenerate,
	onFeedback,
	onAnnotate,
}: MessageFooterProps) {
	const { t, i18n } = useTranslation()
	const { token } = theme.useToken()
	const { app, parameters, difyApi } = useAppContext()
	const { message: toast } = App.useApp()
	const reportTtsError = useCallback(
		(error: DifyRequestError) => toast.error(error.message || t('common.request_failed_retry')),
		[t, toast],
	)
	const tts = useTts(difyApi, reportTtsError)
	const [dislikeOpen, setDislikeOpen] = useState(false)

	const actions = footerActions(message, status, {
		annotation: app.settings.annotationEnabled,
		tts: Boolean(parameters.text_to_speech?.enabled),
		hasQuestion,
	})
	if (!actions) return null

	const rating = message.feedback ?? null
	// X's Audio item has no disabled state: it looks like antd's disabled controls through its semantic
	// styles and ignores clicks meanwhile. A clip that plays can always be stopped; a new one waits.
	const ttsIdle = tts.status === 'default' || tts.status === 'error'
	const ttsRunning = tts.status === 'running'
	const ttsLabel = t(ttsRunning ? 'message.stop_reading' : 'message.tts')
	const inactive: React.CSSProperties | undefined =
		disabled && ttsIdle ? { color: token.colorTextDisabled, cursor: 'not-allowed' } : undefined
	const toggleTts = () => {
		if (disabled && ttsIdle) return
		void tts.toggle(message.content)
	}

	const items: ActionsProps['items'] = []
	if (actions.regenerate) {
		items.push({
			key: 'regenerate',
			actionRender: () => (
				<Button
					type="text"
					size="small"
					icon={<RedoOutlined />}
					aria-label={t('message.action_regenerate')}
					title={t('message.action_regenerate')}
					disabled={disabled}
					onClick={() => onRegenerate(messageKey)}
				/>
			),
		})
	}
	if (actions.copy) {
		// antd's Typography copy button, named by antd's locale ("Copy").
		items.push({ key: 'copy', actionRender: () => <Actions.Copy text={message.content} /> })
	}
	if (actions.annotate) {
		items.push({
			key: 'annotate',
			actionRender: () => (
				<Button
					type="text"
					size="small"
					icon={<EditOutlined />}
					aria-label={t('message.annotation')}
					title={t('message.annotation')}
					disabled={disabled}
					onClick={() => onAnnotate(messageKey)}
				/>
			),
		})
	}
	if (actions.feedback) {
		// Named toggle buttons (aria-pressed); the chosen one is filled and coloured (spec §10), the other
		// keeps the text button's colour. Choosing the chosen one again takes the rating back.
		items.push({
			key: 'like',
			actionRender: () => (
				<Button
					type="text"
					size="small"
					icon={rating === 'like' ? <LikeFilled /> : <LikeOutlined />}
					aria-label={t('message.like')}
					title={t('message.like')}
					aria-pressed={rating === 'like'}
					disabled={disabled}
					style={rating === 'like' ? { color: token.colorSuccess } : undefined}
					onClick={() => void onFeedback(messageKey, message, rating === 'like' ? null : 'like')}
				/>
			),
		})
		items.push({
			key: 'dislike',
			actionRender: () => (
				<DislikePopover
					open={dislikeOpen}
					onCancel={() => setDislikeOpen(false)}
					onSubmit={reason => {
						setDislikeOpen(false)
						void onFeedback(messageKey, message, 'dislike', reason)
					}}
				>
					<Button
						type="text"
						size="small"
						icon={rating === 'dislike' ? <DislikeFilled /> : <DislikeOutlined />}
						aria-label={t('message.dislike')}
						title={t('message.dislike')}
						aria-pressed={rating === 'dislike'}
						disabled={disabled}
						style={rating === 'dislike' ? { color: token.colorError } : undefined}
						onClick={() => {
							if (rating === 'dislike') void onFeedback(messageKey, message, null)
							else setDislikeOpen(true)
						}}
					/>
				</DislikePopover>
			),
		})
	}
	if (actions.tts) {
		items.push({
			key: 'tts',
			// Actions.Audio forwards these attributes to its item (React.HTMLAttributes, picked by pickAttrs):
			// it becomes a named, focusable button (WAI-ARIA button pattern: Enter and Space activate it).
			actionRender: () => (
				<Actions.Audio
					status={tts.status}
					role="button"
					tabIndex={0}
					aria-label={ttsLabel}
					aria-pressed={ttsRunning}
					aria-disabled={disabled && ttsIdle}
					styles={{ root: inactive }}
					onClick={toggleTts}
					onKeyDown={event => {
						if (event.key !== 'Enter' && event.key !== ' ') return
						event.preventDefault()
						toggleTts()
					}}
				/>
			),
		})
	}

	return (
		<Flex
			align="center"
			gap="small"
			wrap
		>
			<Actions
				items={items}
				variant="borderless"
			/>
			{actions.time && message.createdAt !== undefined && (
				<Typography.Text type="secondary">
					<time
						dateTime={new Date(message.createdAt * 1000).toISOString()}
						title={t('message.sent_at')}
					>
						{formatDateTime(message.createdAt * 1000, i18n.resolvedLanguage)}
					</time>
				</Typography.Text>
			)}
		</Flex>
	)
}

export default memo(MessageFooter)
