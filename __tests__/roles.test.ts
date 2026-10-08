import { describe, expect, it } from 'vitest'

import { MANAGEABLE_ROLES, ROLES, canManage, hasAdminRights, isRole } from '@/lib/auth/roles'

describe('roles', () => {
	it('has the three roles of B2 (ADR-0024)', () => {
		expect(ROLES).toEqual(['owner', 'admin', 'user'])
	})

	it('recognises a role and nothing else', () => {
		for (const role of ROLES) expect(isRole(role)).toBe(true)
		for (const value of ['Admin', 'superuser', '', null, undefined, 1])
			expect(isRole(value)).toBe(false)
	})

	it('gives the owner and an admin the admin surface, not a user', () => {
		expect(hasAdminRights({ role: 'owner' })).toBe(true)
		expect(hasAdminRights({ role: 'admin' })).toBe(true)
		expect(hasAdminRights({ role: 'user' })).toBe(false)
	})
})

// ADR-0024: each role manages only the roles below it; the owner role is in no list.
describe('the rank', () => {
	it('lists what each role manages', () => {
		expect(MANAGEABLE_ROLES).toEqual({ owner: ['admin', 'user'], admin: ['user'], user: [] })
	})

	it.each([
		['owner', 'owner', false],
		['owner', 'admin', true],
		['owner', 'user', true],
		['admin', 'owner', false],
		['admin', 'admin', false],
		['admin', 'user', true],
		['user', 'owner', false],
		['user', 'admin', false],
		['user', 'user', false],
	] as const)('%s manages %s: %s', (actor, target, expected) => {
		expect(canManage(actor, target)).toBe(expected)
	})
})
