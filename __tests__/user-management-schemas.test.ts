import { describe, expect, it } from 'vitest'

import {
	createUserInputSchema,
	userIdSchema,
	userInputSchema,
} from '@/app/(admin)/user-management/schemas'

const base = { name: 'Jane', email: 'jane@example.com', role: 'user' }

describe('user input schemas', () => {
	it('requires a password of 8 characters to 72 bytes on create (decision f)', () => {
		expect(createUserInputSchema.safeParse({ ...base, password: 'password-1' }).success).toBe(true)
		expect(createUserInputSchema.safeParse(base).success).toBe(false)
		expect(createUserInputSchema.safeParse({ ...base, password: '1234567' }).success).toBe(false)
		expect(createUserInputSchema.safeParse({ ...base, password: 'x'.repeat(72) }).success).toBe(
			true,
		)
		expect(createUserInputSchema.safeParse({ ...base, password: 'x'.repeat(73) }).success).toBe(
			false,
		)
	})
	it('treats a blank or missing password as "keep" on update', () => {
		expect(userInputSchema.safeParse(base).success).toBe(true)
		expect(userInputSchema.safeParse({ ...base, password: '' }).success).toBe(true)
		expect(userInputSchema.safeParse({ ...base, password: '1234567' }).success).toBe(false)
	})
	it("accepts the three roles: the rank is the DAL's, and the owner's own row sends owner (ADR-0024)", () => {
		for (const role of ['owner', 'admin', 'user']) {
			expect(userInputSchema.safeParse({ ...base, role }).success).toBe(true)
		}
	})
	it('refuses an unknown role, a bad email and a blank name, and strips unknown keys', () => {
		expect(userInputSchema.safeParse({ ...base, role: 'superuser' }).success).toBe(false)
		expect(userInputSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false)
		expect(userInputSchema.safeParse({ ...base, name: '   ' }).success).toBe(false)
		const parsed = userInputSchema.parse({ ...base, sessionVersion: 9 })
		expect(parsed).not.toHaveProperty('sessionVersion')
	})
	it('accepts any id up to the column length (decision h: legacy ids are not UUIDs)', () => {
		expect(userIdSchema.safeParse('cm1abcdefghijk').success).toBe(true)
		expect(userIdSchema.safeParse('3b241101-e2bb-4255-8caf-4136c566a962').success).toBe(true)
		expect(userIdSchema.safeParse('').success).toBe(false)
		expect(userIdSchema.safeParse('x'.repeat(37)).success).toBe(false)
	})
})
