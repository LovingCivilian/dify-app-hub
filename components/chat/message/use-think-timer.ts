'use client'

import { useEffect, useRef, useState } from 'react'

import useThinkTimeStore, { setThinkTime } from '@/components/chat/persistence/think-time-storage'

const secondsSince = (startedAt: number) => Math.round((Date.now() - startedAt) / 100) / 10

/**
 * Seconds a reasoning block has been open (while `loading`) or took (afterwards). The time is counted
 * only for a block seen streaming and is stored under `storageKey` (built from the Dify message id, so
 * the history finds it); a block never seen streaming shows the stored time, if any. Shared by the
 * Markdown `<think>` block and the `reasoning_chunk` block.
 */
export const useThinkTimer = (
	storageKey: string | undefined,
	loading: boolean,
): number | undefined => {
	// Subscribed rather than read once: the store hydrates from IndexedDB asynchronously.
	const stored = useThinkTimeStore(state => (storageKey ? state.data[storageKey] : undefined))
	const [elapsed, setElapsed] = useState<number>()
	const startedAt = useRef<number | undefined>(undefined)

	useEffect(() => {
		if (!loading) return
		startedAt.current ??= Date.now()
		const timer = setInterval(() => setElapsed(secondsSince(startedAt.current!)), 100)
		return () => clearInterval(timer)
	}, [loading])

	// The block closed: keep the final time and store it. The store keeps a key's first value, so a
	// second block of the same kind in one message shows its own time only until a reload.
	useEffect(() => {
		if (loading || startedAt.current === undefined) return
		const seconds = secondsSince(startedAt.current)
		startedAt.current = undefined
		setElapsed(seconds)
		if (storageKey) setThinkTime(storageKey, seconds)
	}, [loading, storageKey])

	return loading ? (elapsed ?? 0) : (elapsed ?? stored)
}
