import { afterAll, describe, expect, it } from 'vitest'

import {
	DEFAULT_LANGUAGE,
	LANGUAGE_COOKIE,
	languageCookieOptions,
	readLanguageCookie,
	SUPPORTED_LANGUAGES,
} from '@/lib/i18n/language-cookie'
import { getAntdLocale } from '@/libs/antd-locale'
import { intlLocale } from '@/libs/format-date'
import i18n from '@/libs/i18n'

const store = (values: Record<string, string>) => (name: string) => values[name]

describe('readLanguageCookie', () => {
	it("uses the language detector's cookie name and defaults to English", () => {
		expect(LANGUAGE_COOKIE).toBe('i18next')
		expect(DEFAULT_LANGUAGE).toBe('en')
	})

	it.each(SUPPORTED_LANGUAGES)('reads %s', language => {
		expect(readLanguageCookie(store({ [LANGUAGE_COOKIE]: language }))).toBe(language)
	})

	it('defaults to English without the cookie', () => {
		expect(readLanguageCookie(store({}))).toBe('en')
		expect(readLanguageCookie(store({ theme: 'dark' }))).toBe('en')
	})

	// Junk never breaks the server render.
	it.each(['', 'fr', 'xx', 'english', 'cimode', '<script>', 'AR', ' ar'])(
		'falls back to English for %j',
		value => {
			expect(readLanguageCookie(store({ [LANGUAGE_COOKIE]: value }))).toBe('en')
		},
	)

	// The detector caches the language it found, so a browser language arrives with its region.
	it.each([
		['ar-SA', 'ar'],
		['ar-EG', 'ar'],
		['ar_SA', 'ar'],
		['zh-CN', 'zh'],
		['zh-TW', 'zh'],
		['zh-Hant-TW', 'zh'],
		['en-US', 'en'],
		['fr-CA', 'en'],
	])('reduces %s to %s', (value, expected) => {
		expect(readLanguageCookie(store({ [LANGUAGE_COOKIE]: value }))).toBe(expected)
	})
})

// The detector writes the cookie with these options (README "Detector Options": `cookieOptions`, MDN
// Set-Cookie attributes), like the theme cookies (themeCookieStrings): whole site, Lax, Secure on https.
describe('languageCookieOptions', () => {
	it('marks the cookie Secure only when the page is served over https', () => {
		expect(languageCookieOptions(true)).toEqual({ path: '/', sameSite: 'lax', secure: true })
		expect(languageCookieOptions(false)).toEqual({ path: '/', sameSite: 'lax', secure: false })
	})

	it('is what libs/i18n.ts gives the detector (no window under vitest, so not secure)', () => {
		expect(i18n.options.detection?.cookieOptions).toEqual(languageCookieOptions(false))
	})
})

// The server renders readLanguageCookie's answer and the browser renders what i18next resolves from the
// same cookie value; they must agree, or the first client render does not match the first HTML.
describe('the server reading agrees with i18next', () => {
	afterAll(async () => {
		await i18n.changeLanguage('en')
	})

	it('lists exactly the languages libs/i18n.ts loads', () => {
		expect([...SUPPORTED_LANGUAGES].sort()).toEqual(
			Object.keys(i18n.options.resources ?? {}).sort(),
		)
	})

	it.each([
		'en',
		'zh',
		'ar',
		'ar-SA',
		'ar_SA',
		'zh-TW',
		'zh-Hant-TW',
		'en-US',
		'fr',
		'fr-CA',
		'xx',
		'AR',
		'AR-sa',
	])('for %s', async value => {
		await i18n.changeLanguage(value)
		expect(readLanguageCookie(store({ [LANGUAGE_COOKIE]: value }))).toBe(i18n.resolvedLanguage)
	})

	it.each(SUPPORTED_LANGUAGES.filter(language => language !== 'en'))(
		'%s has its own Ant Design pack and Intl locale',
		language => {
			expect(getAntdLocale(language)).not.toBe(getAntdLocale('en'))
			expect(intlLocale(language)).not.toBe(intlLocale('en'))
		},
	)
})
