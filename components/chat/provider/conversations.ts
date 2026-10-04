import type { ConversationData } from '@ant-design/x-sdk'

import type { IConversationItem } from '@/lib/api'

import { conversationKeyFor, parseConversationKey } from './keys'

export type ConversationGroup = 'today' | 'yesterday' | 'week' | 'older'

/** A sidebar item: a client key plus the Dify id once the server has one (spec §4.4). */
export interface ConversationItem extends ConversationData {
	key: string
	label: string
	difyId?: string
	/** unix seconds */
	updatedAt: number
	inputs: Record<string, unknown>
	group: ConversationGroup
}

const DAY_MS = 24 * 60 * 60 * 1000
// The user's local calendar date as a UTC timestamp: the difference of two of these is a whole number of
// days whatever the offset or DST (subtracting local-midnight timestamps would be off by an hour on a
// 23 h or 25 h day).
const localDay = (ms: number) => {
	const d = new Date(ms)
	return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Local calendar days between `updatedAtSeconds` and `nowMs`: today, yesterday, up to six days back, older. */
export const groupFor = (updatedAtSeconds: number, nowMs: number): ConversationGroup => {
	const days = Math.round((localDay(nowMs) - localDay(updatedAtSeconds * 1000)) / DAY_MS)
	if (days <= 0) return 'today'
	if (days === 1) return 'yesterday'
	if (days < 7) return 'week'
	return 'older'
}

export const toConversationItem = (
	appId: string,
	dify: IConversationItem,
	nowMs: number,
): ConversationItem => ({
	key: conversationKeyFor(appId, dify.id),
	label: dify.name,
	difyId: dify.id,
	updatedAt: dify.updated_at,
	inputs: dify.inputs ?? {},
	group: groupFor(dify.updated_at, nowMs),
})

/**
 * Refresh from the server without changing client keys: a temporary conversation that already has
 * its Dify id keeps its key (the x-sdk store is bound to it) and takes the server's name; unsent
 * temporaries stay on top; conversations the server dropped disappear.
 */
export const mergeServerList = (
	current: ConversationItem[],
	server: ConversationItem[],
): ConversationItem[] => {
	const unsentTemps = current.filter(c => parseConversationKey(c.key).temp && !c.difyId)
	const keyByDifyId = new Map<string, string>()
	for (const c of current) if (c.difyId) keyByDifyId.set(c.difyId, c.key)
	const merged = server.map(item => {
		const key = item.difyId ? keyByDifyId.get(item.difyId) : undefined
		return key ? { ...item, key } : item
	})
	return [...unsentTemps, ...merged]
}
