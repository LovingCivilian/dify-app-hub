import { describe, expect, it } from 'vitest'

import {
	isUnsentTemp,
	mergeConversations,
	toConversationItem,
	type SharedConversationItem,
} from '@/components/shared-chat/conversations'
import { conversationKeyFor, newTempConversationKey } from '@/components/shared-chat/keys'

const APP = 'e2e00000-0000-4000-8000-0000000000a1'
const NOW = Date.UTC(2026, 9, 14, 12)
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'

describe('toConversationItem', () => {
	it('keys the item by its id, groups it by its last activity and labels an untitled one', () => {
		const item = toConversationItem(
			APP,
			{ id: C1, title: '', updatedAt: new Date(NOW).toISOString() },
			NOW,
			'New conversation',
		)
		expect(item).toEqual({
			key: conversationKeyFor(APP, C1),
			label: 'New conversation',
			conversationId: C1,
			updatedAt: NOW / 1000,
			group: 'today',
		})
		expect(
			toConversationItem(
				APP,
				{ id: C1, title: 'Tea', updatedAt: new Date(NOW - 30 * 86_400_000).toISOString() },
				NOW,
				'New conversation',
			),
		).toMatchObject({ label: 'Tea', group: 'older' })
	})
})

describe('mergeConversations', () => {
	const server = (id: string, title: string) =>
		toConversationItem(
			APP,
			{ id, title, updatedAt: new Date(NOW).toISOString() },
			NOW,
			'New conversation',
		)
	it('keeps unsent new chats on top and the key a live chat already has', () => {
		const unsent: SharedConversationItem = {
			key: newTempConversationKey(APP),
			label: 'New conversation',
			updatedAt: NOW / 1000,
			group: 'today',
		}
		const named: SharedConversationItem = {
			...unsent,
			key: newTempConversationKey(APP),
			conversationId: C1,
		}
		const merged = mergeConversations([unsent, named], [server(C1, 'Tea'), server(C2, 'Coffee')])
		expect(merged.map(c => c.key)).toEqual([unsent.key, named.key, conversationKeyFor(APP, C2)])
		expect(merged[1]).toMatchObject({ label: 'Tea', conversationId: C1 })
		expect(isUnsentTemp(merged[0])).toBe(true)
		expect(isUnsentTemp(merged[1])).toBe(false)
	})
	it('keeps the active conversation in its place when the server no longer lists it', () => {
		const active = server(C1, 'Tea')
		const merged = mergeConversations([active], [server(C2, 'Coffee')], { activeKey: active.key })
		expect(merged.map(c => c.conversationId)).toEqual([C1, C2])
	})
})
