import { useXConversations } from '@ant-design/x-sdk'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { deleteConversationAction, renameConversationAction } from '@/app/(user)/chat/actions'
import { RequestError } from '@/lib/http/browser'

import type { SharedChatApi } from '../api'
import {
	isUnsentTemp,
	mergeConversations,
	regroup,
	toConversationItem,
	type SharedConversationItem,
} from '../conversations'
import { conversationKeyFor, newTempConversationKey, parseConversationKey } from '../keys'
import { toRequestError } from './chat-helpers'

interface Options {
	appId: string
	api: SharedChatApi
	/** `?isNewCvst=1`: start on a new conversation instead of the latest one (the Dify chat's link parameter). */
	startNew?: boolean
}

/**
 * The sidebar list and the active key on useXConversations (x-sdk), fed from GET conversations (spec §4.2), the shape of
 * the Dify chat's useConversations. Rename and delete are Server Actions (spec §4.2: the hub's own data, ADR-0024); a
 * refusal rejects with a RequestError carrying the action's code, so `useConversationMenu` keeps its modal open.
 */
export const useSharedConversations = ({ appId, api, startNew = false }: Options) => {
	const { t } = useTranslation()
	// The store's methods are stable (one store per mount, x-sdk x-conversations).
	const {
		conversations: items,
		activeConversationKey: activeKey,
		setActiveConversationKey,
		addConversation,
		removeConversation,
		setConversation,
		getConversation,
		setConversations,
	} = useXConversations({ defaultConversations: [], defaultActiveConversationKey: '' })
	const conversations = items as SharedConversationItem[]
	const [loading, setLoading] = useState(true)
	/** The last failed load. */
	const [error, setError] = useState<RequestError | null>(null)

	// Read by the callbacks after an await (React: refs are written in effects, not during rendering).
	const latest = useRef({ appId, api, t, startNew, conversations, activeKey })
	useLayoutEffect(() => {
		latest.current = { appId, api, t, startNew, conversations, activeKey }
	})

	const itemOf = useCallback(
		(key: string) => getConversation(key) as SharedConversationItem | undefined,
		[getConversation],
	)

	/** A new chat on top, made active; at most one unsent one exists (the Dify chat's rule), which is reused. */
	const createTemp = useCallback(() => {
		// Checked against the store itself: the rendered list may still hold a temp just removed.
		const existing = latest.current.conversations
			.map(item => itemOf(item.key))
			.find(item => item !== undefined && isUnsentTemp(item))
		if (existing) {
			setActiveConversationKey(existing.key)
			return existing.key
		}
		const key = newTempConversationKey(appId)
		const item: SharedConversationItem = {
			key,
			label: latest.current.t('chat.default_conversation_name'),
			updatedAt: Math.floor(Date.now() / 1000),
			group: 'today',
		}
		addConversation(item, 'prepend')
		setActiveConversationKey(key)
		return key
	}, [addConversation, appId, itemOf, setActiveConversationKey])

	/** Reloads the list and merges it without changing client keys. Never rejects: a failure is kept in `error`. */
	const refresh = useCallback(async (): Promise<SharedConversationItem[] | null> => {
		try {
			const page = await latest.current.api.listConversations()
			// An answer for an app the page has since left changes nothing.
			if (latest.current.appId !== appId) return null
			const now = Date.now()
			const label = latest.current.t('chat.default_conversation_name')
			const server = page.items.map(item => toConversationItem(appId, item, now, label))
			const current = latest.current.conversations.filter(
				item => parseConversationKey(item.key).appId === appId,
			)
			const merged = regroup(
				mergeConversations(current, server, { activeKey: latest.current.activeKey }),
				now,
			)
			setConversations(merged)
			setError(null)
			return merged
		} catch (e) {
			if (latest.current.appId === appId) setError(toRequestError(e))
			return null
		}
	}, [appId, setConversations])

	// The list is loaded once per app; refresh() is called explicitly afterwards.
	useEffect(() => {
		let cancelled = false
		setConversations([])
		setActiveConversationKey('')
		setLoading(true)
		void refresh().then(list => {
			if (cancelled) return
			// Without a list (or with ?isNewCvst=1) the page still opens on a chat it can send to.
			if (latest.current.startNew || !list?.length) createTemp()
			else setActiveConversationKey(list[0]!.key)
			setLoading(false)
		})
		return () => {
			cancelled = true
		}
	}, [appId, createTemp, refresh, setActiveConversationKey, setConversations])

	const getConversationId = useCallback((key: string) => itemOf(key)?.conversationId, [itemOf])

	/**
	 * A new chat's first stream named its conversation (`hub:run`, spec §4.4); the key stays (ADR-0017). A refresh that
	 * ran before listed it under its server key: that twin goes, because this key holds the live message store.
	 */
	const markConversation = useCallback(
		(key: string, conversationId: string, title: string) => {
			const known = itemOf(key)
			if (!known || known.conversationId === conversationId) return
			setConversation(key, { key, conversationId, ...(title ? { label: title } : {}) })
			const twin = conversationKeyFor(appId, conversationId)
			if (twin === key || !itemOf(twin)) return
			removeConversation(twin)
			if (latest.current.activeKey === twin) setActiveConversationKey(key)
		},
		[appId, itemOf, removeConversation, setActiveConversationKey, setConversation],
	)

	/** Renames on the hub, then locally; rejects with a RequestError and keeps the label on a refusal. */
	const rename = useCallback(
		async (key: string, name: string) => {
			const conversationId = getConversationId(key)
			if (conversationId) {
				const result = await renameConversationAction(latest.current.appId, conversationId, name)
				if (!result.ok) throw new RequestError(0, result.code, '')
			}
			setConversation(key, { key, label: name })
		},
		[getConversationId, setConversation],
	)

	/** Deletes on the hub (a soft delete, spec §3.4), then locally, activating the next conversation. */
	const remove = useCallback(
		async (key: string) => {
			const conversationId = getConversationId(key)
			if (conversationId) {
				const result = await deleteConversationAction(latest.current.appId, conversationId)
				if (!result.ok) throw new RequestError(0, result.code, '')
			}
			const { conversations: current, activeKey: active } = latest.current
			removeConversation(key)
			if (active !== key) return
			const rest = current.filter(item => item.key !== key)
			if (rest.length) setActiveConversationKey(rest[0]!.key)
			else createTemp()
		},
		[createTemp, getConversationId, removeConversation, setActiveConversationKey],
	)

	/** A chat the server has not stored yet has nothing to rename (useConversationMenu offers delete only). */
	const canRename = useCallback(
		(key: string) => Boolean(getConversationId(key)),
		[getConversationId],
	)

	return {
		conversations,
		activeKey,
		setActiveKey: setActiveConversationKey,
		loading,
		error,
		createTemp,
		markConversation,
		rename,
		remove,
		refresh,
		getConversationId,
		canRename,
		hasEmptyTemp: conversations.some(isUnsentTemp),
	}
}
