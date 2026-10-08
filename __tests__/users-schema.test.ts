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

describe('the B2 migrations', () => {
	const folders = readdirSync('db/migrations')
	const alter = folders.find(name => name.endsWith('_b2-users-role'))
	const backfill = folders.find(name => name.endsWith('_b2-users-role-backfill'))
	const read = (dir: string) =>
		readFileSync(path.join('db/migrations', dir, 'migration.sql'), 'utf8')

	it('adds the column alone in its own migration', () => {
		expect(alter).toBeDefined()
		expect(read(alter!).trim()).toBe(
			"ALTER TABLE `users` ADD `role` enum('owner','admin','user') DEFAULT 'user' NOT NULL;",
		)
	})

	it('backfills in a later custom migration: every account an admin, then the oldest the owner (ADR-0024: no lock-out on upgrade)', () => {
		expect(backfill).toBeDefined()
		// the migrator applies folders in name order
		expect(backfill! > alter!).toBe(true)
		const statements = read(backfill!)
			.split('--> statement-breakpoint')
			.map(part =>
				part
					.split('\n')
					.filter(line => !line.startsWith('--'))
					.join('\n')
					.trim(),
			)
		expect(statements).toEqual([
			"UPDATE `users` SET `role` = 'admin';",
			"UPDATE `users` SET `role` = 'owner' ORDER BY `created_at`, `id` LIMIT 1;",
		])
	})
})
