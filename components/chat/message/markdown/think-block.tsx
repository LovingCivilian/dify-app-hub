'use client'

import { Think } from '@ant-design/x'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import useThinkTimeStore, { setThinkTime } from '@/components/chat/persistence/think-time-storage'

import type { MarkdownBlockProps } from './dom-node'
import { useMarkdownMessageId } from './message-context'

const secondsSince = (startedAt: number) => Math.round((Date.now() - startedAt) / 100) / 10

/**
 * <think> blocks (inline reasoning): open while the tag is still streaming, collapsed with the elapsed time once
 * it closes. A block that was never seen streaming (history) shows the time the think-time store remembers.
 */
export default function ThinkBlock({ children, streamStatus }: MarkdownBlockProps) {
	const { t } = useTranslation()
	const messageId = useMarkdownMessageId()
	const storageKey = messageId ? `${messageId}_think` : undefined
	// Subscribed rather than read once: the store hydrates from IndexedDB asynchronously.
	const storedSeconds = useThinkTimeStore(state =>
		storageKey ? state.data[storageKey] : undefined,
	)
	const loading = streamStatus === 'loading'
	const [expanded, setExpanded] = useState(loading)
	const [elapsed, setElapsed] = useState<number>()
	const startedAt = useRef<number | undefined>(undefined)

	// React docs, "Adjusting some state when a prop changes": open with the stream, collapse when it ends.
	const [wasLoading, setWasLoading] = useState(loading)
	if (loading !== wasLoading) {
		setWasLoading(loading)
		setExpanded(loading)
	}

	useEffect(() => {
		if (!loading) return
		startedAt.current ??= Date.now()
		const timer = setInterval(() => setElapsed(secondsSince(startedAt.current!)), 100)
		return () => clearInterval(timer)
	}, [loading])

	useEffect(() => {
		if (loading || startedAt.current === undefined) return
		const seconds = secondsSince(startedAt.current)
		startedAt.current = undefined
		setElapsed(seconds)
		if (storageKey) setThinkTime(storageKey, seconds)
	}, [loading, storageKey])

	const doneSeconds = elapsed ?? storedSeconds
	const title = loading
		? t('message.think.in_progress', { seconds: (elapsed ?? 0).toFixed(1) })
		: doneSeconds !== undefined
			? t('message.think.done_with_time', { seconds: doneSeconds.toFixed(1) })
			: t('message.think.done')

	return (
		<Think
			title={title}
			loading={loading}
			blink={loading}
			expanded={expanded}
			onExpand={setExpanded}
		>
			{children}
		</Think>
	)
}
