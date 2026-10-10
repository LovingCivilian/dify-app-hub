import { describe, expect, it } from 'vitest'

import ar from '@/locales/ar/translation.json'
import en from '@/locales/en/translation.json'
import zh from '@/locales/zh/translation.json'

type Tree = { [key: string]: string | Tree }

const flatten = (tree: Tree, prefix = ''): Record<string, string> =>
	Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
		const path = prefix ? `${prefix}.${key}` : key
		return typeof value === 'string'
			? { ...acc, [path]: value }
			: { ...acc, ...flatten(value, path) }
	}, {})

const placeholders = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort()

const enFlat = flatten(en)
// Every locale other than English is checked against the English file.
const translations: Record<string, Record<string, string>> = {
	zh: flatten(zh),
	ar: flatten(ar),
}

describe('locale files', () => {
	it.each(Object.keys(translations))('define the same keys in en and %s', locale => {
		expect(Object.keys(translations[locale]).sort()).toEqual(Object.keys(enFlat).sort())
	})

	it('have no empty values', () => {
		const empty = [enFlat, ...Object.values(translations)]
			.flatMap(flat => Object.entries(flat))
			.filter(([, value]) => value.trim() === '')
			.map(([key]) => key)
		expect(empty).toEqual([])
	})

	it.each(Object.keys(translations))(
		'use the same interpolation placeholders in en and %s',
		locale => {
			const mismatched = Object.keys(enFlat).filter(
				key =>
					placeholders(enFlat[key]).join() !== placeholders(translations[locale][key] ?? '').join(),
			)
			expect(mismatched).toEqual([])
		},
	)

	it('keep Chinese characters out of the English file', () => {
		const leaked = Object.entries(enFlat)
			.filter(([, value]) => /[一-鿿]/.test(value))
			.map(([key]) => key)
		expect(leaked).toEqual([])
	})

	it('keep Chinese characters out of the Arabic file', () => {
		const leaked = Object.entries(translations.ar)
			.filter(([, value]) => /[一-鿿]/.test(value))
			.map(([key]) => key)
		expect(leaked).toEqual([])
	})

	it('write the Arabic file in Arabic script', () => {
		// Keys that are legitimately Latin-only (product names, format strings) are listed here.
		// The directory connection's protocol names (spec §6.6) stay as written in every language.
		const latinOnly = new Set<string>([
			'admin_users.directory_ldaps',
			'admin_users.directory_starttls',
		])
		const notArabic = Object.entries(translations.ar)
			.filter(([key, value]) => !latinOnly.has(key) && !/[؀-ۿ]/.test(value))
			.map(([key]) => key)
		expect(notArabic).toEqual([])
	})

	it('never use "count" as an interpolation variable', () => {
		const offenders = [enFlat, ...Object.values(translations)]
			.flatMap(flat => Object.entries(flat))
			.filter(([, value]) => value.includes('{{count}}'))
			.map(([key]) => key)
		expect(offenders).toEqual([])
	})
})
