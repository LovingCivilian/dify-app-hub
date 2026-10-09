import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { getTableConfig } from 'drizzle-orm/mysql-core'
import { describe, expect, it } from 'vitest'

import {
	appGroupGrants,
	appUserGrants,
	difyApps,
	userGroupMembers,
	userGroups,
	users,
} from '@/db/schema'

describe('the B3a schema (B3 spec §3.1)', () => {
	it('adds two deactivation markers and who deactivated, all nullable, to users', () => {
		expect(users.adminDeactivatedAt.notNull).toBe(false)
		expect(users.adminDeactivatedBy.notNull).toBe(false)
		expect(users.directoryDeactivatedAt.notNull).toBe(false)
		// No foreign key on who deactivated: deleting that admin keeps the record.
		expect(getTableConfig(users).foreignKeys).toEqual([])
	})

	it('closes a new app by default (spec §2 #9)', () => {
		expect(difyApps.accessMode.enumValues).toEqual(['everyone', 'restricted'])
		expect(difyApps.accessMode.notNull).toBe(true)
		expect(difyApps.accessMode.default).toBe('restricted')
	})

	it('names groups uniquely and records the source of each membership', () => {
		expect(getTableConfig(userGroups).name).toBe('user_groups')
		expect(getTableConfig(userGroups).indexes.map(index => index.config.name)).toEqual([
			'user_groups_name_key',
		])
		expect(userGroupMembers.source.enumValues).toEqual(['manual', 'directory'])
		const [primary] = getTableConfig(userGroupMembers).primaryKeys
		expect(primary.columns.map(column => column.name)).toEqual(['group_id', 'user_id', 'source'])
	})

	it.each([
		['user_group_members', userGroupMembers, ['user_groups', 'users']],
		['app_group_grants', appGroupGrants, ['dify_apps', 'user_groups']],
		['app_user_grants', appUserGrants, ['dify_apps', 'users']],
	] as const)('%s cascades every foreign key on delete', (_name, table, parents) => {
		const keys = getTableConfig(table).foreignKeys
		expect(keys.map(key => key.onDelete)).toEqual(parents.map(() => 'cascade'))
		expect(keys.map(key => getTableConfig(key.reference().foreignTable).name).sort()).toEqual(
			[...parents].sort(),
		)
	})
})

describe('the B3a migrations', () => {
	const folders = readdirSync('db/migrations')
	const generated = folders.find(name => name.endsWith('_b3a-groups-access'))
	const backfill = folders.find(name => name.endsWith('_b3a-apps-open-to-everyone'))
	const read = (dir: string) =>
		readFileSync(path.join('db/migrations', dir, 'migration.sql'), 'utf8')
	const statements = (sql: string) =>
		sql
			.split('--> statement-breakpoint')
			.map(part =>
				part
					.split('\n')
					.filter(line => !line.startsWith('--'))
					.join('\n')
					.trim(),
			)
			.filter(Boolean)

	it('creates the four tables and adds the columns', () => {
		expect(generated).toBeDefined()
		const sql = read(generated!)
		for (const table of [
			'user_groups',
			'user_group_members',
			'app_group_grants',
			'app_user_grants',
		])
			expect(sql).toContain(`CREATE TABLE \`${table}\``)
		expect(sql).toContain(
			"ALTER TABLE `dify_apps` ADD `access_mode` enum('everyone','restricted') DEFAULT 'restricted' NOT NULL;",
		)
		for (const column of [
			'admin_deactivated_at',
			'admin_deactivated_by',
			'directory_deactivated_at',
		])
			expect(sql).toContain(`ALTER TABLE \`users\` ADD \`${column}\``)
	})

	// drizzle-kit 1.0.0-rc.3 leaves ON DELETE out when a migration creates exactly one table with foreign keys
	// (spec §3.2); pin that every foreign key here cascades.
	it('writes ON DELETE CASCADE on all six foreign keys', () => {
		const sql = read(generated!)
		expect(sql.match(/FOREIGN KEY/g)).toHaveLength(6)
		expect(
			sql.match(/FOREIGN KEY \(`[a-z_]+`\) REFERENCES `[a-z_]+`\(`id`\) ON DELETE CASCADE/g),
		).toHaveLength(6)
	})

	it('opens every existing app to everyone in a later custom migration (spec §2 #9)', () => {
		expect(backfill).toBeDefined()
		// the migrator applies folders in name order
		expect(backfill! > generated!).toBe(true)
		expect(statements(read(backfill!))).toEqual([
			"UPDATE `dify_apps` SET `access_mode` = 'everyone';",
		])
	})
})
