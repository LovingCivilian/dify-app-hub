import { describe, expect, it } from 'vitest'

import {
	GROUP_DESCRIPTION_MAX,
	GROUP_NAME_MAX,
	directoryGroupSearchSchema,
	directorySearchText,
	groupIdSchema,
	groupInputSchema,
} from '@/app/(admin)/group-management/schemas'

describe('groupInputSchema (decision c)', () => {
	// Task 12 review I1: an absent `directoryGroups` stays absent, which the DAL reads as "no change".
	it('trims, and defaults the description and members, and leaves the directory groups absent', () => {
		expect(groupInputSchema.parse({ name: '  Finance  ' })).toEqual({
			name: 'Finance',
			description: '',
			memberIds: [],
		})
	})

	it('refuses a blank or too long name and a too long description', () => {
		expect(groupInputSchema.safeParse({ name: '   ' }).success).toBe(false)
		expect(groupInputSchema.safeParse({ name: 'x'.repeat(GROUP_NAME_MAX + 1) }).success).toBe(false)
		expect(groupInputSchema.safeParse({ name: 'x'.repeat(GROUP_NAME_MAX) }).success).toBe(true)
		expect(
			groupInputSchema.safeParse({ name: 'N', description: 'd'.repeat(GROUP_DESCRIPTION_MAX + 1) })
				.success,
		).toBe(false)
	})

	it('takes account ids by B2 decision h (1 to 36 characters)', () => {
		expect(groupInputSchema.safeParse({ name: 'N', memberIds: ['legacy-id'] }).success).toBe(true)
		expect(groupInputSchema.safeParse({ name: 'N', memberIds: [''] }).success).toBe(false)
		expect(groupInputSchema.safeParse({ name: 'N', memberIds: ['x'.repeat(37)] }).success).toBe(
			false,
		)
	})

	it('takes UUIDs as group ids', () => {
		expect(groupIdSchema.safeParse(crypto.randomUUID()).success).toBe(true)
		expect(groupIdSchema.safeParse('g1').success).toBe(false)
	})
})

describe('directory groups on the group input (decision am)', () => {
	it('takes canonical keys with a name, at most 50', () => {
		const key = 'b95f3990-b59a-4a1b-9e96-86c66cb18d99'
		expect(
			groupInputSchema.parse({ name: 'Eng', directoryGroups: [{ id: key, name: ' Engineering ' }] })
				.directoryGroups,
		).toEqual([{ id: key, name: 'Engineering' }])
		expect(groupInputSchema.parse({ name: 'Eng', directoryGroups: [] }).directoryGroups).toEqual([])
		expect(groupInputSchema.parse({ name: 'Eng' })).not.toHaveProperty('directoryGroups')
		expect(
			groupInputSchema.safeParse({
				name: 'Eng',
				directoryGroups: [{ id: key.toUpperCase(), name: 'x' }],
			}).success,
		).toBe(false)
		expect(
			groupInputSchema.safeParse({
				name: 'Eng',
				directoryGroups: Array.from({ length: 51 }, () => ({ id: key, name: 'x' })),
			}).success,
		).toBe(false)
	})

	it('bounds the search text (decision al)', () => {
		expect(directoryGroupSearchSchema.parse('  eng ')).toBe('eng')
		expect(directoryGroupSearchSchema.safeParse('e').success).toBe(false)
		expect(directoryGroupSearchSchema.safeParse('x'.repeat(65)).success).toBe(false)
	})

	// Task 12 review M3: what the drawer sends is never over the route's bound, so the route's 400 cannot come back.
	it('cuts the drawer’s search text to the route’s 64 code points', () => {
		expect(directorySearchText('  eng ')).toBe('eng')
		expect(directorySearchText('x'.repeat(70))).toBe('x'.repeat(64))
		expect(directorySearchText('😀'.repeat(70))).toBe('😀'.repeat(64))
		// A cut that ends in spaces is trimmed again, so it parses as the route trims it.
		expect(directorySearchText(`a${' '.repeat(63)}b`)).toBe('a')
		for (const text of ['ab', 'x'.repeat(70), '😀'.repeat(70), `ab${' '.repeat(62)}c`])
			expect(directoryGroupSearchSchema.safeParse(directorySearchText(text)).success).toBe(true)
	})
})
