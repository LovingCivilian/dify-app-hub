import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { directorySyncRuns, userGroupDirectoryLinks, users } from '@/db/schema'

describe('the B3b schema (B3 spec §3.2)', () => {
	it('gives every account a source and lets a directory account have no password', () => {
		expect(users.source.enumValues).toEqual(['local', 'ldap'])
		expect(users.source.getSQLType()).toBe('account_source')
		expect(users.source.notNull).toBe(true)
		expect(users.source.default).toBe('local')
		expect(users.password.notNull).toBe(false)
		for (const column of [users.directoryId, users.directoryIdAttribute, users.directoryUsername])
			expect(column.notNull).toBe(false)
	})

	it('keeps one account per directory key, beside the unique email and the one owner', () => {
		const names = getTableConfig(users).indexes.map(index => index.config.name)
		expect(names).toEqual(['users_email_key', 'users_directory_id_key', 'users_one_owner'])
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

	it('records sync runs with a unique slot and the column name kept', () => {
		const config = getTableConfig(directorySyncRuns)
		expect(config.name).toBe('directory_sync_runs')
		expect(config.columns.map(column => column.name)).not.toContain('trigger')
		expect(directorySyncRuns.runTrigger.enumValues).toEqual(['schedule', 'startup', 'manual'])
		expect(directorySyncRuns.runTrigger.getSQLType()).toBe('sync_trigger')
		expect(directorySyncRuns.outcome.enumValues).toEqual([
			'running',
			'succeeded',
			'failed',
			'empty',
			'id_attribute_changed',
		])
		expect(directorySyncRuns.outcome.getSQLType()).toBe('sync_outcome')
		expect(directorySyncRuns.outcome.default).toBe('running')
		const slot = config.indexes.find(index => index.config.name === 'directory_sync_runs_slot_key')!
		expect(slot.config.unique).toBe(true)
		expect(config.foreignKeys).toEqual([])
	})
})
