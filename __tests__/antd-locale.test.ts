import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'

import { applyDayjsLocale, getAntdLocale } from '@/libs/antd-locale'

describe('getAntdLocale', () => {
	it.each([
		['en', 'en'],
		['zh', 'zh-cn'],
		['ar', 'ar'],
	])('maps %s to the Ant Design %s pack', (language, antdLocale) => {
		expect(getAntdLocale(language).locale).toBe(antdLocale)
	})

	it('falls back to English for an unknown or missing language', () => {
		expect(getAntdLocale('fr').locale).toBe('en')
		expect(getAntdLocale(undefined).locale).toBe('en')
	})
})

describe('applyDayjsLocale', () => {
	it.each([
		['en', 'en', 'January'],
		['zh', 'zh-cn', '一月'],
		['ar', 'ar', 'يناير'],
	])('switches Day.js to %s so dates format in that language', (language, dayjsLocale, january) => {
		applyDayjsLocale(language)
		expect(dayjs.locale()).toBe(dayjsLocale)
		expect(dayjs('2026-01-15').format('MMMM')).toBe(january)
	})

	it('formats Arabic dates with Arabic-Indic digits (preParsePostFormat plugin)', () => {
		applyDayjsLocale('ar')
		expect(dayjs('2026-01-15 09:05').format('YYYY-MM-DD HH:mm')).toBe('٢٠٢٦-٠١-١٥ ٠٩:٠٥')
	})

	it('falls back to English for an unknown language', () => {
		applyDayjsLocale('zh')
		applyDayjsLocale('fr')
		expect(dayjs.locale()).toBe('en')
	})
})
