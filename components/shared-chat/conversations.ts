import type { ConversationData } from '@ant-design/x-sdk'

import { groupFor, type ConversationGroup } from '@/components/chat/provider/conversations'
import type { ConversationListItem } from '@/lib/data/conversations'

import { conversationKeyFor, parseConversationKey } from './keys'

/** A sidebar item (spec §5.1): a client key, the server's id once the conversation has one, and its date group. */
export interface SharedConversationItem extends ConversationData {
	key: string
	label: string
	conversationId?: string
	/** Unix seconds, as `groupFor` reads them. */
	updatedAt: number
	group: ConversationGroup
}

/** An item of GET conversations; an untitled conversation reads as the localised "New conversation" (spec §3.1). */
export const toConversationItem = (
	appId: string,
	item: ConversationListItem,
	nowMs: number,
	defaultLabel: string,
): SharedConversationItem => {
	const updatedAt = Math.floor(Date.parse(item.updatedAt) / 1000)
	return {
		key: conversationKeyFor(appId, item.id),
		label: item.title || defaultLabel,
		conversationId: item.id,
		updatedAt,
		group: groupFor(updatedAt, nowMs),
	}
}

/** Groups are relative to now: recomputed on every refresh, so a list left open past midnight relabels. */
export const regroup = (items: SharedConversationItem[], nowMs: number): SharedConversationItem[] =>
	items.map(item => ({ ...item, group: groupFor(item.updatedAt, nowMs) }))

export const isUnsentTemp = (item: SharedConversationItem) =>
	parseConversationKey(item.key).temp && !item.conversationId

/**
 * The server's list without changing client keys (the Dify chat's `mergeServerList` rule, for the shared item): unsent
 * new chats stay on top; a chat that got its id this page session keeps its temporary key (its x-sdk store is bound to
 * it) and takes the server's title; the active conversation keeps its place when the page does not list it.
 */
export const mergeConversations = (
	current: SharedConversationItem[],
	server: SharedConversationItem[],
	{ activeKey }: { activeKey?: string } = {},
): SharedConversationItem[] => {
	const unsent = current.filter(isUnsentTemp)
	const byId = new Map<string, SharedConversationItem>()
	for (const item of current) if (item.conversationId) byId.set(item.conversationId, item)
	const merged = server.map(item => {
		const known = item.conversationId ? byId.get(item.conversationId) : undefined
		return known ? { ...item, key: known.key } : item
	})
	const result = [...unsent, ...merged]
	const activeIndex = activeKey ? current.findIndex(item => item.key === activeKey) : -1
	if (activeIndex !== -1 && !result.some(item => item.key === activeKey)) {
		result.splice(Math.min(activeIndex, result.length), 0, current[activeIndex]!)
	}
	return result
}
