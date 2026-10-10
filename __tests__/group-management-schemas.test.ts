import { describe, expect, it } from 'vitest'

import {
	GROUP_DESCRIPTION_MAX,
	GROUP_NAME_MAX,
	groupIdSchema,
	groupInputSchema,
} from '@/app/(admin)/group-management/schemas'

describe('groupInputSchema (decision c)', () => {
	it('trims, and defaults the description and members', () => {
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
