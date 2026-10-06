import { describe, expect, it } from 'vitest'

import { firstParam } from '@/lib/search-params'

// Next hands a page `searchParams` as string | string[] | undefined per key (page.md).
describe('firstParam', () => {
	it('returns a single value as is and the first of a repeated key', () => {
		expect(firstParam('abc')).toBe('abc')
		expect(firstParam(['first', 'second'])).toBe('first')
	})

	it('returns undefined for a missing key, an empty list or an empty string', () => {
		expect(firstParam(undefined)).toBeUndefined()
		expect(firstParam([])).toBeUndefined()
		expect(firstParam('')).toBeUndefined()
	})
})
