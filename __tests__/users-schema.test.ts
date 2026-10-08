import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { users } from '@/db/schema'

describe('users schema', () => {
	it('stores the role as an enum that defaults to user (charter §4.4, ADR-0024)', () => {
		expect(users.role.enumValues).toEqual(['owner', 'admin', 'user'])
		expect(users.role.notNull).toBe(true)
		expect(users.role.default).toBe('user')
	})

	it('stamps updated_at on every update through Drizzle', () => {
		expect(users.updatedAt.onUpdateFn).toBeTypeOf('function')
	})
})

describe('the B2 migration', () => {
	it('adds the column, makes every existing account an admin, then the oldest the owner (ADR-0024: no lock-out on upgrade)', () => {
		const dir = readdirSync('db/migrations').find(name => name.endsWith('_b2-users-role'))
		expect(dir).toBeDefined()
		const sql = readFileSync(path.join('db/migrations', dir!, 'migration.sql'), 'utf8')
		const add = sql.indexOf("ADD `role` enum('owner','admin','user') DEFAULT 'user' NOT NULL")
		const backfill = sql.indexOf("UPDATE `users` SET `role` = 'admin';--> statement-breakpoint")
		const owner = sql.indexOf(
			"UPDATE `users` SET `role` = 'owner' ORDER BY `created_at`, `id` LIMIT 1;",
		)
		expect(add).toBeGreaterThanOrEqual(0)
		expect(backfill).toBeGreaterThan(add)
		expect(owner).toBeGreaterThan(backfill)
	})
})
