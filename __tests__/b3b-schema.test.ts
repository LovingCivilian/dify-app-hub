import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { getTableConfig } from 'drizzle-orm/mysql-core'
import { describe, expect, it } from 'vitest'

import { directorySyncRuns, userGroupDirectoryLinks, users } from '@/db/schema'

describe('the B3b schema (B3 spec §3.2)', () => {
	it('gives every account a source and lets a directory account have no password', () => {
		expect(users.source.enumValues).toEqual(['local', 'ldap'])
		expect(users.source.notNull).toBe(true)
		expect(users.source.default).toBe('local')
		expect(users.password.notNull).toBe(false)
		for (const column of [users.directoryId, users.directoryIdAttribute, users.directoryUsername])
			expect(column.notNull).toBe(false)
	})

	it('keeps one account per directory key, beside the unique email', () => {
		const names = getTableConfig(users).indexes.map(index => index.config.name)
		expect(names).toEqual(['users_email_key', 'users_directory_id_key'])
		const directoryKey = getTableConfig(users).indexes.find(
			index => index.config.name === 'users_directory_id_key',
		)!
		expect(directoryKey.config.unique).toBe(true)
	})

	it('ties the source to the credentials with a CHECK', () => {
		expect(getTableConfig(users).checks.map(check => check.name)).toEqual([
			'users_source_credentials',
		])
	})

	it('links a hub group to directory groups by key, cascading with the group', () => {
		const config = getTableConfig(userGroupDirectoryLinks)
		expect(config.name).toBe('user_group_directory_links')
		expect(config.primaryKeys[0].columns.map(column => column.name)).toEqual([
			'group_id',
			'directory_group_id',
		])
		expect(config.foreignKeys.map(key => key.onDelete)).toEqual(['cascade'])
		expect(getTableConfig(config.foreignKeys[0].reference().foreignTable).name).toBe('user_groups')
		expect(userGroupDirectoryLinks.missingSince.notNull).toBe(false)
	})

	it('records sync runs with a unique slot and no reserved column name', () => {
		const config = getTableConfig(directorySyncRuns)
		expect(config.name).toBe('directory_sync_runs')
		expect(config.columns.map(column => column.name)).not.toContain('trigger')
		expect(directorySyncRuns.runTrigger.enumValues).toEqual(['schedule', 'startup', 'manual'])
		expect(directorySyncRuns.outcome.enumValues).toEqual([
			'running',
			'succeeded',
			'failed',
			'empty',
			'id_attribute_changed',
		])
		expect(directorySyncRuns.outcome.default).toBe('running')
		const slot = config.indexes.find(index => index.config.name === 'directory_sync_runs_slot_key')!
		expect(slot.config.unique).toBe(true)
		expect(config.foreignKeys).toEqual([])
	})
})

describe('the B3b migration', () => {
	const folder = readdirSync('db/migrations').find(name => name.endsWith('_b3b-directory'))
	const sql = () => readFileSync(path.join('db/migrations', folder!, 'migration.sql'), 'utf8')
	const statements = () =>
		sql()
			.split('--> statement-breakpoint')
			.map(part => part.trim())
			.filter(Boolean)

	it('creates both tables and changes users', () => {
		expect(folder).toBeDefined()
		expect(sql()).toContain('CREATE TABLE `user_group_directory_links`')
		expect(sql()).toContain('CREATE TABLE `directory_sync_runs`')
		expect(sql()).toContain('ALTER TABLE `users` MODIFY COLUMN `password` varchar(255);')
		expect(sql()).toContain(
			"ALTER TABLE `users` ADD `source` enum('local','ldap') DEFAULT 'local' NOT NULL;",
		)
		expect(sql()).toContain(
			'CREATE UNIQUE INDEX `users_directory_id_key` ON `users` (`directory_id`);',
		)
	})

	// drizzle-kit 1.0.0-rc.3 leaves ON DELETE out when a migration creates exactly one table with foreign keys (spec
	// §3.2); this migration creates two, so the action must be there.
	it('writes ON DELETE CASCADE on its one foreign key', () => {
		expect(sql().match(/FOREIGN KEY/g)).toHaveLength(1)
		expect(sql()).toMatch(
			/FOREIGN KEY \(`group_id`\) REFERENCES `user_groups`\(`id`\) ON DELETE CASCADE/,
		)
	})

	// MySQL 8.4 "ALTER TABLE": adding a CHECK that existing rows break fails; every existing account is local with a
	// password, so the CHECK comes after the column changes that make that true.
	it('adds the CHECK after every change to users columns', () => {
		const all = statements()
		const check = all.findIndex(statement => statement.includes('CHECK'))
		expect(check).toBeGreaterThan(-1)
		expect(all[check]).toMatch(
			/^ALTER TABLE `users` ADD CONSTRAINT `users_source_credentials` CHECK/,
		)
		const columnChanges = all
			.map((statement, index) =>
				/^ALTER TABLE `users` (ADD `|MODIFY COLUMN)/.test(statement) ? index : -1,
			)
			.filter(index => index >= 0)
		expect(columnChanges.length).toBeGreaterThanOrEqual(5)
		expect(Math.max(...columnChanges)).toBeLessThan(check)
	})
})
