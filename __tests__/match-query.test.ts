import { describe, expect, it } from 'vitest'

import { matchesQuery } from '@/lib/match-query'

describe('matchesQuery', () => {
	it('matches any field case-insensitively and ignores surrounding spaces', () => {
		expect(matchesQuery(['Stub agent', 'Seeded'], '  STUB ')).toBe(true)
		expect(matchesQuery(['Alpha', undefined, null, 'support'], 'PORT')).toBe(true)
	})

	it('lets everything through for an empty or all-space query', () => {
		expect(matchesQuery(['Alpha'], '')).toBe(true)
		expect(matchesQuery(['Alpha'], '   ')).toBe(true)
	})

	it('rejects a query that no field contains', () => {
		expect(matchesQuery(['Alpha', 'Beta'], 'gamma')).toBe(false)
		expect(matchesQuery([undefined, null], 'a')).toBe(false)
	})

	it('matches Arabic and Chinese text', () => {
		expect(matchesQuery(['تطبيق المحادثة'], 'المحادثة')).toBe(true)
		expect(matchesQuery(['客服助手'], '助手')).toBe(true)
	})
})
