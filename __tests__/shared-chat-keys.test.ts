import { describe, expect, it } from 'vitest'

import {
	conversationKeyFor,
	newTempConversationKey,
	parseConversationKey,
} from '@/components/shared-chat/keys'

const APP = 'e2e00000-0000-4000-8000-0000000000a1'
const CONVERSATION = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b'

describe('shared chat keys (ADR-0017)', () => {
	it('keys a stored conversation by the app and its id, and reads both back', () => {
		const key = conversationKeyFor(APP, CONVERSATION)
		expect(key).toBe(`${APP}:${CONVERSATION}`)
		expect(parseConversationKey(key)).toEqual({
			appId: APP,
			conversationId: CONVERSATION,
			temp: false,
		})
	})
	it('gives a new chat a temporary key with no conversation id', () => {
		const key = newTempConversationKey(APP)
		expect(key).toMatch(new RegExp(`^${APP}:temp:[0-9a-f-]{36}$`))
		expect(parseConversationKey(key)).toEqual({ appId: APP, temp: true })
		expect(newTempConversationKey(APP)).not.toBe(key)
	})
	it('reads the empty key as no conversation', () => {
		expect(parseConversationKey('')).toEqual({ appId: '', conversationId: undefined, temp: false })
	})
})
