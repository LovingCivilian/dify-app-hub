'use client'

import { Think } from '@ant-design/x'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { thinkTitle } from '../think-title'
import { useThinkTimer } from '../use-think-timer'
import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownMessageId } from './message-context'

/**
 * <think> blocks (inline reasoning): open while the tag is still streaming, collapsed with the elapsed time once
 * it closes. A block that was never seen streaming (history) shows the time the think-time store remembers.
 */
export default function ThinkBlock({ children, streamStatus }: MarkdownBlockProps) {
	const { t, i18n } = useTranslation()
	const messageId = useMarkdownMessageId()
	const loading = streamStatus === 'loading'
	const seconds = useThinkTimer(messageId ? `${messageId}_think` : undefined, loading)
	const [expanded, setExpanded] = useState(loading)

	// React docs, "Adjusting some state when a prop changes": open with the stream, collapse when it ends.
	const [wasLoading, setWasLoading] = useState(loading)
	if (loading !== wasLoading) {
		setWasLoading(loading)
		setExpanded(loading)
	}

	return (
		<Think
			title={thinkTitle(t, loading, seconds, i18n.resolvedLanguage)}
			loading={loading}
			blink={loading}
			expanded={expanded}
			onExpand={setExpanded}
		>
			{children}
		</Think>
	)
}
