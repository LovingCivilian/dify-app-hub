import { afterAll, describe, expect, it } from 'vitest'

import i18n from '@/libs/i18n'

describe('i18n setup', () => {
	afterAll(async () => {
		await i18n.changeLanguage('en')
	})

	it.each([
		['en', 'en'],
		['en-US', 'en'],
		['zh', 'zh'],
		['zh-CN', 'zh'],
		['zh-TW', 'zh'],
		['fr', 'en'],
		['ja', 'en'],
	])('resolves %s to %s', async (language, expected) => {
		await i18n.changeLanguage(language)
		expect(i18n.resolvedLanguage).toBe(expected)
	})

	it('translates the same key in both languages', async () => {
		await i18n.changeLanguage('en')
		expect(i18n.t('common.cancel')).toBe('Cancel')
		await i18n.changeLanguage('zh')
		expect(i18n.t('common.cancel')).toBe('取消')
	})

	it('falls back to English text, not the raw key, for an unsupported language', async () => {
		await i18n.changeLanguage('fr')
		expect(i18n.t('auth.login')).toBe('Log in')
	})

	it('interpolates an Error object as its message', async () => {
		await i18n.changeLanguage('en')
		expect(i18n.t('app.fetch_list_failed', { error: new Error('boom') })).toBe(
			'Failed to load apps: Error: boom',
		)
	})

	it('defines the key the rename dialog already uses', async () => {
		await i18n.changeLanguage('en')
		expect(i18n.t('chat.rename_placeholder')).toBe('Enter a conversation name')
	})
})
