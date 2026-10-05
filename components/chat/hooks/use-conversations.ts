import { useXConversations } from '@ant-design/x-sdk'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { IConversationItem } from '@/lib/api'
import type { DifyApi } from '@/lib/dify-client'

import {
	mergeServerList,
	regroup,
	toConversationItem,
	type ConversationItem,
} from '../provider/conversations'
import type { DifyRequestError } from '../provider/dify-fetch'
import { conversationKeyFor, newTempConversationKey, parseConversationKey } from '../provider/keys'
import { envelopeError, toDifyError } from './dify-errors'

/** The newest conversations the sidebar lists (Dify's maximum `limit` for GET /conversations). */
const LIST_LIMIT = 100

interface Options {
	appId: string
	difyApi: DifyApi
	/** `?isNewCvst=1`: start on a new conversation instead of the latest one. */
	startNew?: boolean
}

/** GET /conversations as `DifyApi.listConversations` returns it: the page, or Dify's error body. */
interface ConversationsAnswer {
	data?: IConversationItem[]
}

const isUnsentTemp = (item: ConversationItem) => parseConversationKey(item.key).temp && !item.difyId

/** The sidebar list and the active key on useXConversations (x-sdk), fed from Dify's /conversations (spec §4.4). */
export const useConversations = ({ appId, difyApi, startNew = false }: Options) => {
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
	const conversations = items as ConversationItem[]
	const [loading, setLoading] = useState(true)
	/** The last failed load: `{ status, code?, message }`, `message` being Dify's text or ''. */
	const [error, setError] = useState<DifyRequestError | null>(null)

	// Read by the callbacks after an await (React: refs are written in effects, not during rendering).
	const latest = useRef({ appId, difyApi, t, startNew, conversations, activeKey })
	useLayoutEffect(() => {
		latest.current = { appId, difyApi, t, startNew, conversations, activeKey }
	})

	/** A new chat on top, made active; at most one unsent one exists (spec §4.4), which is reused. */
	const createTemp = useCallback(() => {
		// Checked against the store itself: the rendered list may still hold a temp just removed.
		const existing = latest.current.conversations
			.map(c => getConversation(c.key) as ConversationItem | undefined)
			.find(c => c !== undefined && isUnsentTemp(c))
		if (existing) {
			setActiveConversationKey(existing.key)
			return existing.key
		}
		const key = newTempConversationKey(appId)
		const item: ConversationItem = {
			key,
			label: latest.current.t('chat.default_conversation_name'),
			updatedAt: Math.floor(Date.now() / 1000),
			inputs: {},
			group: 'today',
		}
		addConversation(item, 'prepend')
		setActiveConversationKey(key)
		return key
	}, [addConversation, appId, getConversation, setActiveConversationKey])

	/**
	 * Reload the list and merge it without changing client keys (mergeServerList); groups are
	 * recomputed against now. Never rejects: a failure is kept in `error` and gives null.
	 */
	const refresh = useCallback(async (): Promise<ConversationItem[] | null> => {
		try {
			const answer = (await latest.current.difyApi.listConversations({
				limit: LIST_LIMIT,
				sort_by: '-updated_at',
			})) as ConversationsAnswer | undefined
			// An answer for an app the page has since left changes nothing.
			if (latest.current.appId !== appId) return null
			if (!Array.isArray(answer?.data)) throw envelopeError(answer)
			const now = Date.now()
			const server = answer.data.map(item => toConversationItem(appId, item, now))
			const current = latest.current.conversations.filter(
				c => parseConversationKey(c.key).appId === appId,
			)
			const merged = regroup(
				mergeServerList(current, server, {
					activeKey: latest.current.activeKey,
					defaultLabel: latest.current.t('chat.default_conversation_name'),
				}),
				now,
			)
			setConversations(merged)
			setError(null)
			return merged
		} catch (e) {
			if (latest.current.appId === appId) setError(toDifyError(e))
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
			else setActiveConversationKey(list[0].key)
			setLoading(false)
		})
		return () => {
			cancelled = true
		}
	}, [appId, createTemp, refresh, setActiveConversationKey, setConversations])

	const getDifyId = useCallback(
		(key: string) => (getConversation(key) as ConversationItem | undefined)?.difyId,
		[getConversation],
	)

	/**
	 * A new chat's first reply brought its Dify id; the key stays (spec §4.4). A refresh that ran before
	 * the stream named the conversation listed it under its server key: that twin goes, because this key
	 * holds the live message store.
	 */
	const markDifyId = useCallback(
		(key: string, difyId: string) => {
			if (!setConversation(key, { key, difyId })) return
			const twin = conversationKeyFor(appId, difyId)
			if (twin === key || !getConversation(twin)) return
			removeConversation(twin)
			if (latest.current.activeKey === twin) setActiveConversationKey(key)
		},
		[appId, getConversation, removeConversation, setActiveConversationKey, setConversation],
	)

	/** The stored parameter values of `key`, read from the store itself (the rendered list lags a write). */
	const getInputs = useCallback(
		(key: string) => (getConversation(key) as ConversationItem | undefined)?.inputs ?? {},
		[getConversation],
	)

	/** The conversation's parameter values, as the form holds them (spec §5.2); the server's take over after a refresh. */
	const setInputs = useCallback(
		(key: string, inputs: Record<string, unknown>) => {
			setConversation(key, { key, inputs })
		},
		[setConversation],
	)

	/** Renames on Dify, then locally; rejects with a DifyRequestError and keeps the label on failure. */
	const rename = useCallback(
		async (key: string, name: string) => {
			const difyId = getDifyId(key)
			if (difyId) {
				try {
					// Dify answers a rename with the conversation; anything else is its error body.
					const answer = (await latest.current.difyApi.renameConversation({
						conversation_id: difyId,
						name,
					})) as { id?: unknown } | undefined
					if (typeof answer?.id !== 'string') throw envelopeError(answer)
				} catch (e) {
					throw toDifyError(e)
				}
			}
			setConversation(key, { key, label: name })
		},
		[getDifyId, setConversation],
	)

	/** Deletes on Dify, then locally; rejects with a DifyRequestError and keeps the item on failure. */
	const remove = useCallback(
		async (key: string) => {
			const difyId = getDifyId(key)
			if (difyId) {
				try {
					const response = await latest.current.difyApi.deleteConversation(difyId)
					if (!response.ok) {
						throw envelopeError(await response.json().catch(() => null), response.status)
					}
				} catch (e) {
					throw toDifyError(e)
				}
			}
			const { conversations: current, activeKey: active } = latest.current
			removeConversation(key)
			if (active !== key) return
			const rest = current.filter(c => c.key !== key)
			if (rest.length) setActiveConversationKey(rest[0].key)
			else createTemp()
		},
		[createTemp, getDifyId, removeConversation, setActiveConversationKey],
	)

	return {
		conversations,
		activeKey,
		setActiveKey: setActiveConversationKey,
		loading,
		error,
		createTemp,
		markDifyId,
		getInputs,
		setInputs,
		rename,
		remove,
		refresh,
		getDifyId,
		hasEmptyTemp: conversations.some(isUnsentTemp),
	}
}
