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
		['ar', 'ar'],
		['ar-SA', 'ar'],
		['ar-EG', 'ar'],
		['fr', 'en'],
		['ja', 'en'],
	])('resolves %s to %s', async (language, expected) => {
		await i18n.changeLanguage(language)
		expect(i18n.resolvedLanguage).toBe(expected)
	})

	it('translates the same key in every language', async () => {
		await i18n.changeLanguage('en')
		expect(i18n.t('common.cancel')).toBe('Cancel')
		await i18n.changeLanguage('zh')
		expect(i18n.t('common.cancel')).toBe('取消')
		await i18n.changeLanguage('ar')
		expect(i18n.t('common.cancel')).toBe('إلغاء')
	})

	// The server render's instance (components/providers/app-providers.tsx): a clone in the cookie's language that
	// leaves the shared module instance alone, and that react-i18next's useSSR skips (it checks options.isClone).
	it('gives a server render its own language without changing the shared instance', async () => {
		await i18n.changeLanguage('en')
		const clone = i18n.cloneInstance({ lng: 'ar' })
		expect(clone.resolvedLanguage).toBe('ar')
		expect(clone.t('common.cancel')).toBe('إلغاء')
		expect(clone.options).toHaveProperty('isClone', true)
		expect(i18n.resolvedLanguage).toBe('en')
		expect(i18n.t('common.cancel')).toBe('Cancel')
	})

	it('reports Arabic as right-to-left', () => {
		expect(i18n.dir('ar')).toBe('rtl')
		expect(i18n.dir('en')).toBe('ltr')
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

	it('reads naturally when the human-input countdown has expired', async () => {
		await i18n.changeLanguage('en')
		expect(i18n.t('hitl.remaining', { time: i18n.t('hitl.expired') })).toBe('⏱ Time left: Expired')
		expect(i18n.t('hitl.remaining', { time: '5m 3s' })).toBe('⏱ Time left: 5m 3s')
	})

	it('defines the key the rename dialog already uses', async () => {
		await i18n.changeLanguage('en')
		expect(i18n.t('chat.rename_placeholder')).toBe('Enter a conversation name')
	})
})
