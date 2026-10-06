import enUS from '@ant-design/x/locale/en_US'
import { describe, expect, it } from 'vitest'

import { getXLocale } from '@/libs/x-locale'

const keysOf = (value: unknown, prefix = ''): string[] =>
	Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
		typeof v === 'object' && v ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`],
	)

describe('getXLocale', () => {
	it.each(['en', 'zh', 'ar'])('has the same keys as the English pack for %s', language => {
		expect(keysOf(getXLocale(language)).sort()).toEqual(keysOf(enUS).sort())
	})
	it('marks the Arabic pack as ar and translates every string', () => {
		const ar = getXLocale('ar')
		expect(ar.locale).toBe('ar')
		for (const key of keysOf(ar).filter(k => k !== 'locale')) {
			const value = key
				.split('.')
				.reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], ar) as string
			expect(value, key).toMatch(/[؀-ۿ]/)
		}
	})
	it('falls back to English for an unknown language', () => {
		expect(getXLocale('fr').locale).toBe('en')
		expect(getXLocale(undefined).locale).toBe('en')
	})
})
