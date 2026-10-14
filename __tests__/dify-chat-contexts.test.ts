import { describe, expect, it } from 'vitest'

import { DEFAULT_SITE_SETTINGS } from '@/components/chat/app-answers'
import type { DifyChatApp } from '@/components/chat/app-context'
import { difyChatContexts } from '@/components/chat/dify-chat-contexts'
import type { DifyApi } from '@/lib/providers/dify/browser'

const app = {
	id: 'a1',
	provider: 'dify',
	name: 'Tea',
	description: 'Brews tea',
	enabled: true,
	hasIcon: true,
	appType: 'chat',
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
	},
} as DifyChatApp
const difyApi = {
	remoteFileUrl: (url: string) => `/api/dify/a1/files/remote?url=${encodeURIComponent(url)}`,
} as unknown as DifyApi

describe('the Dify chat’s contexts (Part 2 spec §5.1)', () => {
	it('names the app by its site settings first', () => {
		const site = { ...DEFAULT_SITE_SETTINGS, title: 'Tea room', description: 'Ask about tea' }
		expect(difyChatContexts({ app, site, difyApi }).appInfo).toEqual({
			id: 'a1',
			name: 'Tea room',
			description: 'Ask about tea',
			hasIcon: true,
		})
	})

	it('falls back to the app record when the site has no title or description', () => {
		expect(difyChatContexts({ app, site: DEFAULT_SITE_SETTINGS, difyApi }).appInfo).toEqual({
			id: 'a1',
			name: 'Tea',
			description: 'Brews tea',
			hasIcon: true,
		})
	})

	it('sends Dify’s file links through the remote-file route and keeps every other link', () => {
		const { rewriteLink } = difyChatContexts({ app, site: DEFAULT_SITE_SETTINGS, difyApi })
		expect(rewriteLink('/files/tools/x.png?timestamp=1&nonce=2&sign=3')).toBe(
			'/api/dify/a1/files/remote?url=%2Ffiles%2Ftools%2Fx.png%3Ftimestamp%3D1%26nonce%3D2%26sign%3D3',
		)
		expect(rewriteLink('https://example.com/page')).toBe('https://example.com/page')
		expect(rewriteLink(undefined)).toBeUndefined()
	})
})
