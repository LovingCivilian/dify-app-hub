'use client'

import { Think } from '@ant-design/x'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import styles from './reasoning.module.css'
import { thinkTitle } from './think-title'
import { useThinkTimer } from './use-think-timer'

export interface ReasoningProps {
	reasoning: string
	/** `reasoning_chunk` with `is_final` arrived, or the reply ended. */
	done: boolean
	streaming: boolean
	/** Dify message id: the time is stored under it (the history has the same id). */
	messageId?: string
}

/**
 * A chatflow's `reasoning_chunk` text in X Think (spec §5.2): open and blinking while it streams, closed
 * with the time it took once done. Named as a group so it reads apart from `<think>` blocks in the answer.
 */
export default function Reasoning({ reasoning, done, streaming, messageId }: ReasoningProps) {
	const { t, i18n } = useTranslation()
	const loading = streaming && !done
	const seconds = useThinkTimer(messageId ? `${messageId}_reasoning` : undefined, loading)
	const [expanded, setExpanded] = useState(loading)
	// React docs, "Adjusting some state when a prop changes": open with the stream, close when it ends.
	const [wasLoading, setWasLoading] = useState(loading)
	if (loading !== wasLoading) {
		setWasLoading(loading)
		setExpanded(loading)
	}
	return (
		<Think
			role="group"
			aria-label={t('message.reasoning_title')}
			title={thinkTitle(t, loading, seconds, i18n.resolvedLanguage)}
			loading={loading}
			blink={loading}
			expanded={expanded}
			onExpand={setExpanded}
		>
			<div className={styles.text}>{reasoning}</div>
		</Think>
	)
}
