'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { DifyApi } from '@/lib/dify/browser'

interface Options {
	enabled: boolean
	difyApi: DifyApi
	/** Replies of another conversation do not count as ended. */
	conversationKey: string
	/** The reply's Dify message id; left out for a reply that was stopped or failed. */
	lastMessageId?: string
	isRequesting: boolean
}

/**
 * Next-question suggestions after a reply ends (GET /messages/{id}/suggested), when the app enables them
 * (spec §4.7). They are fetched once when a reply finishes in the conversation on screen — not for the
 * history of a conversation that is merely opened, since Dify generates them with a model call — and
 * belong to that message: once another message is last (or the reply is gone) they are not returned.
 */
export const useSuggestions = ({
	enabled,
	difyApi,
	conversationKey,
	lastMessageId,
	isRequesting,
}: Options) => {
	const [loaded, setLoaded] = useState<{ messageId: string; items: string[] } | null>(null)
	const previous = useRef({ conversationKey, isRequesting })
	useEffect(() => {
		const replyEnded =
			previous.current.conversationKey === conversationKey &&
			previous.current.isRequesting &&
			!isRequesting
		previous.current = { conversationKey, isRequesting }
		if (!replyEnded || !enabled || !lastMessageId) return
		const messageId = lastMessageId
		difyApi
			.getSuggested(messageId)
			.then(result =>
				setLoaded({ messageId, items: result.data.filter(item => typeof item === 'string') }),
			)
			// A refused request (Dify's 400 when suggestions are off, a 404) means none.
			.catch(() => setLoaded(null))
	}, [enabled, difyApi, conversationKey, lastMessageId, isRequesting])
	const clear = useCallback(() => setLoaded(null), [])
	return {
		suggestions: loaded && loaded.messageId === lastMessageId ? loaded.items : [],
		clear,
	}
}
