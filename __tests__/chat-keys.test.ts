import { describe, expect, it } from 'vitest'

import {
	conversationKeyFor,
	newTempConversationKey,
	parseConversationKey,
} from '@/components/chat/provider/keys'

const APP = 'e2e00000-0000-4000-8000-000000000001'

describe('conversation keys', () => {
	it('prefixes server conversations with the app id', () => {
		expect(conversationKeyFor(APP, 'conv-1')).toBe(`${APP}:conv-1`)
		expect(parseConversationKey(`${APP}:conv-1`)).toEqual({
			appId: APP,
			difyId: 'conv-1',
			temp: false,
		})
	})
	it('marks a new chat as temporary until the server assigns an id', () => {
		const key = newTempConversationKey(APP)
		expect(key.startsWith(`${APP}:temp:`)).toBe(true)
		expect(parseConversationKey(key)).toEqual({ appId: APP, difyId: undefined, temp: true })
	})
	it('never produces the same temporary key twice', () => {
		expect(newTempConversationKey(APP)).not.toBe(newTempConversationKey(APP))
	})
})
