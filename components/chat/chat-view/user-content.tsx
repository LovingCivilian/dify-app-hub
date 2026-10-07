'use client'

import { Flex, Typography } from 'antd'
import { useMemo } from 'react'

import { useAppContext } from '../app-context'
import MessageFiles from '../message/message-files'
import type { DifyChatMessage } from '../provider/message'
import styles from './user-content.module.css'

/**
 * A submitted answer form posts JSON (`isFormSubmit`); with the app's answer-form feedback text set, that
 * text is shown instead of the raw payload (the old chat's rule).
 */
const displayText = (content: string, feedbackText?: string, enabled?: boolean) => {
	if (!enabled || !feedbackText || !content.startsWith('{')) return content
	try {
		return (JSON.parse(content) as { isFormSubmit?: boolean }).isFormSubmit ? feedbackText : content
	} catch {
		return content
	}
}

/** A user bubble (spec §5.2): the files sent with the message above its text. */
export default function UserContent({ message }: { message: DifyChatMessage }) {
	const { app } = useAppContext()
	const { files } = message
	const userFiles = useMemo(() => files?.filter(f => f.belongsTo === 'user'), [files])
	return (
		<Flex
			vertical
			gap="small"
		>
			<MessageFiles files={userFiles} />
			<Typography.Text className={styles.text}>
				{displayText(
					message.content,
					app.settings.answerForm.feedbackText,
					app.settings.answerForm.enabled,
				)}
			</Typography.Text>
		</Flex>
	)
}
