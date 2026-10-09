import { mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core'

import { difyApps } from './apps'
import { userGroups } from './groups'
import { users } from './users'

/*
 * App grants (B3 spec §3.1, ADR-0027): two typed tables rather than one with a principal-type column, so each grant
 * carries foreign keys and is removed with its app, group or account (Metabase relies on the same cascade; LibreChat
 * and Grafana, with a polymorphic column, delete orphans in code). A grant counts only while the app is restricted.
 */

export const appGroupGrants = mysqlTable(
	'app_group_grants',
	{
		appId: varchar('app_id', { length: 36 })
			.notNull()
			.references(() => difyApps.id, { onDelete: 'cascade' }),
		groupId: varchar('group_id', { length: 36 })
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
	},
	table => [primaryKey({ columns: [table.appId, table.groupId] })],
)

export const appUserGrants = mysqlTable(
	'app_user_grants',
	{
		appId: varchar('app_id', { length: 36 })
			.notNull()
			.references(() => difyApps.id, { onDelete: 'cascade' }),
		userId: varchar('user_id', { length: 36 })
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	table => [primaryKey({ columns: [table.appId, table.userId] })],
)
