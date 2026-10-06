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

/** Groups are relative to "now": recompute them on every refresh so a list left open past midnight relabels. */
export const regroup = (items: ConversationItem[], nowMs: number): ConversationItem[] =>
	items.map(item => ({ ...item, group: groupFor(item.updatedAt, nowMs) }))

/**
 * The name Dify gives a new conversation before one is generated: the literal in
 * `MessageBasedAppGenerator._init_generate_records` (`api/core/app/apps/message_based_app_generator.py`).
 * In 0.15.3 and 1.0.0 every new conversation starts with it; from 1.4.0 (and on `main`, read
 * 2026-10-05) only one whose first query is empty, the others start with the query's first 20
 * characters until the name worker writes the generated name.
 */
export const DIFY_PLACEHOLDER_NAME = 'New conversation'

/**
 * Refresh from the server without changing client keys: a temporary conversation that already has
 * its Dify id keeps its key (the x-sdk store is bound to it) and takes the server's name; unsent
 * temporaries stay on top; conversations the server dropped disappear, except the active one, which
 * keeps its place while it is active (a deep-linked conversation older than the server page, or a new
 * chat the list does not show yet). Dify's placeholder name is shown as `defaultLabel`, the localized
 * label new chats get (or, without one, the label the client already had), until a generated name
 * arrives.
 */
export const mergeServerList = (
	current: ConversationItem[],
	server: ConversationItem[],
	{ activeKey, defaultLabel }: { activeKey?: string; defaultLabel?: string } = {},
): ConversationItem[] => {
	const unsentTemps = current.filter(c => parseConversationKey(c.key).temp && !c.difyId)
	const byDifyId = new Map<string, ConversationItem>()
	for (const c of current) if (c.difyId) byDifyId.set(c.difyId, c)
	const merged = server.map(item => {
		const known = item.difyId ? byDifyId.get(item.difyId) : undefined
		const label =
			item.label === DIFY_PLACEHOLDER_NAME
				? (defaultLabel ?? known?.label ?? item.label)
				: item.label
		return known ? { ...item, key: known.key, label } : { ...item, label }
	})
	const result = [...unsentTemps, ...merged]
	const activeIndex = activeKey ? current.findIndex(c => c.key === activeKey) : -1
	if (activeIndex !== -1 && !result.some(c => c.key === activeKey)) {
		result.splice(Math.min(activeIndex, result.length), 0, current[activeIndex])
	}
	return result
}
