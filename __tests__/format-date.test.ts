import { describe, expect, it } from 'vitest'

import { formatDateTime, intlLocale } from '@/libs/format-date'

const date = new Date(2026, 0, 15, 9, 5, 0)

describe('formatDateTime', () => {
	it('formats in Arabic with Arabic-Indic digits and the Gregorian calendar', () => {
		const text = formatDateTime(date, 'ar')
		expect(text).toMatch(/[٠-٩]/)
		expect(text).not.toMatch(/[0-9]/)
		expect(text).toContain('٢٠٢٦')
	})

	it('formats in Chinese as upstream did with zh-CN', () => {
		expect(formatDateTime(date, 'zh')).toBe(date.toLocaleString('zh-CN'))
	})

	it('formats in English for en and for an unknown language', () => {
		expect(formatDateTime(date, 'en')).toBe(date.toLocaleString('en-US'))
		expect(formatDateTime(date, 'fr')).toBe(date.toLocaleString('en-US'))
		expect(formatDateTime(date, undefined)).toBe(date.toLocaleString('en-US'))
	})

	it('accepts epoch milliseconds and ISO strings', () => {
		expect(formatDateTime(date.getTime(), 'en')).toBe(formatDateTime(date, 'en'))
		expect(formatDateTime(date.toISOString(), 'en')).toBe(formatDateTime(date, 'en'))
	})
})

describe('intlLocale', () => {
	it('maps the supported languages to their Intl tags and falls back to English', () => {
		expect(intlLocale('en')).toBe('en-US')
		expect(intlLocale('zh')).toBe('zh-CN')
		expect(intlLocale('ar')).toBe('ar-SA-u-ca-gregory-nu-arab')
		expect(intlLocale('fr')).toBe('en-US')
		expect(intlLocale(undefined)).toBe('en-US')
	})
})
