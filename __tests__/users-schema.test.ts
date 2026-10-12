import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { users } from '@/db/schema'

describe('users schema', () => {
	it('stores the role as an enum that defaults to user (charter §4.4, ADR-0024)', () => {
		expect(users.role.enumValues).toEqual(['owner', 'admin', 'user'])
		expect(users.role.getSQLType()).toBe('user_role')
		expect(users.role.notNull).toBe(true)
		expect(users.role.default).toBe('user')
	})

	it('stamps updated_at on every update through Drizzle', () => {
		expect(users.updatedAt.onUpdateFn).toBeTypeOf('function')
	})

	// Spec §3.2: PostgreSQL's uuid type, the value made by the app so an id is known before the insert.
	it('keys an account by a uuid the app generates', () => {
		expect(users.id.getSQLType()).toBe('uuid')
		expect(users.id.defaultFn).toBeTypeOf('function')
	})

	// DV 2a, 2b: a point in time with its zone, without a precision.
	it('stores its times with their zone', () => {
		expect(users.createdAt.getSQLType()).toBe('timestamp with time zone')
		expect(users.adminDeactivatedAt.getSQLType()).toBe('timestamp with time zone')
	})

	it('allows one owner through a partial unique index (spec §3.4)', () => {
		const index = getTableConfig(users).indexes.find(
			candidate => candidate.config.name === 'users_one_owner',
		)!
		expect(index.config.unique).toBe(true)
		expect(index.config.where).toBeDefined()
	})
})
