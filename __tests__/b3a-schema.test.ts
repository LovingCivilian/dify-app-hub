import { getTableConfig } from 'drizzle-orm/pg-core'
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
		expect(difyApps.accessMode.getSQLType()).toBe('access_mode')
		expect(difyApps.accessMode.notNull).toBe(true)
		expect(difyApps.accessMode.default).toBe('restricted')
	})

	it('names groups uniquely and records the source of each membership', () => {
		expect(getTableConfig(userGroups).name).toBe('user_groups')
		expect(getTableConfig(userGroups).indexes.map(index => index.config.name)).toEqual([
			'user_groups_name_key',
		])
		expect(userGroupMembers.source.enumValues).toEqual(['manual', 'directory'])
		expect(userGroupMembers.source.getSQLType()).toBe('membership_source')
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

	// PostgreSQL 18 "Foreign Keys": no index on the referencing columns is created for a foreign key; InnoDB made one.
	// A composite primary key serves its leading column only, so the second referencing column gets its own (spec §3.2).
	it.each([
		['app_group_grants', appGroupGrants, 'app_group_grants_group_id_idx', 'group_id'],
		['app_user_grants', appUserGrants, 'app_user_grants_user_id_idx', 'user_id'],
		['user_group_members', userGroupMembers, 'user_group_members_user_id_idx', 'user_id'],
	] as const)('%s indexes its second referencing column', (_name, table, name, column) => {
		const [index] = getTableConfig(table).indexes
		expect(index.config.name).toBe(name)
		expect(index.config.unique).toBe(false)
		expect(index.config.columns.map(part => ('name' in part ? part.name : undefined))).toEqual([
			column,
		])
	})
})
