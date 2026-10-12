import { describe, expect, it } from 'vitest'

import { accessSummary } from '@/components/admin/apps/admin-app-row'

describe('accessSummary (spec §4.4: the table tag)', () => {
	it('says everyone, admins only, or how many groups and people', () => {
		expect(accessSummary({ mode: 'everyone', groupIds: ['g1'], userIds: [] })).toEqual({
			kind: 'everyone',
		})
		expect(accessSummary({ mode: 'restricted', groupIds: [], userIds: [] })).toEqual({
			kind: 'admins_only',
		})
		expect(accessSummary({ mode: 'restricted', groupIds: ['g1', 'g2'], userIds: ['u1'] })).toEqual({
			kind: 'restricted',
			groups: 2,
			people: 1,
		})
	})
})
