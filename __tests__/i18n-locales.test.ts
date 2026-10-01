import { describe, expect, it } from 'vitest'

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
const zhFlat = flatten(zh)

describe('locale files', () => {
	it('define the same keys in en and zh', () => {
		expect(Object.keys(zhFlat).sort()).toEqual(Object.keys(enFlat).sort())
	})

	it('have no empty values', () => {
		const empty = [...Object.entries(enFlat), ...Object.entries(zhFlat)]
			.filter(([, value]) => value.trim() === '')
			.map(([key]) => key)
		expect(empty).toEqual([])
	})

	it('use the same interpolation placeholders in en and zh', () => {
		const mismatched = Object.keys(enFlat).filter(
			key => placeholders(enFlat[key]).join() !== placeholders(zhFlat[key] ?? '').join(),
		)
		expect(mismatched).toEqual([])
	})

	it('keep Chinese characters out of the English file', () => {
		const leaked = Object.entries(enFlat)
			.filter(([, value]) => /[一-鿿]/.test(value))
			.map(([key]) => key)
		expect(leaked).toEqual([])
	})

	it('never use "count" as an interpolation variable', () => {
		const offenders = Object.entries({ ...enFlat, ...zhFlat })
			.filter(([, value]) => value.includes('{{count}}'))
			.map(([key]) => key)
		expect(offenders).toEqual([])
	})
})
