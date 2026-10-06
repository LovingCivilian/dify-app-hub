import { describe, expect, it } from 'vitest'

import { toUserRows } from '@/components/admin/users/user-row'

describe('toUserRows', () => {
	it('passes dates to the client as ISO strings, so the browser formats them in its own zone', () => {
		const created = new Date('2026-01-15T09:05:00.000Z')
		expect(
			toUserRows([
				{ id: 'u1', name: null, email: 'a@b.c', createdAt: created, updatedAt: created },
			]),
		).toEqual([
			{
				id: 'u1',
				name: null,
				email: 'a@b.c',
				createdAt: '2026-01-15T09:05:00.000Z',
				updatedAt: '2026-01-15T09:05:00.000Z',
			},
		])
	})
})
