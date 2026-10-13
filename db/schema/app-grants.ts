import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core'

import { apps } from './apps'
import { userGroups } from './groups'
import { users } from './users'

/*
 * App grants (B3 spec §3.1, ADR-0027): two typed tables rather than one with a principal-type column, so each grant
 * carries foreign keys and is removed with its app, group or account (Metabase relies on the same cascade; LibreChat
 * and Grafana, with a polymorphic column, delete orphans in code). A grant counts only while the app is restricted.
 * Each primary key leads with `app_id`; the other referencing column gets its own index, which PostgreSQL does not
 * create for a foreign key ("Foreign Keys": "it is often a good idea to index the referencing columns too"; Part 0 spec
 * §3.2), so a group's or an account's delete and the access rule's lookups by them use an index.
 */

export const appGroupGrants = pgTable(
	'app_group_grants',
	{
		appId: uuid('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		groupId: uuid('group_id')
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
	},
	table => [
		primaryKey({ columns: [table.appId, table.groupId] }),
		index('app_group_grants_group_id_idx').on(table.groupId),
	],
)

export const appUserGrants = pgTable(
	'app_user_grants',
	{
		appId: uuid('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
	},
	table => [
		primaryKey({ columns: [table.appId, table.userId] }),
		index('app_user_grants_user_id_idx').on(table.userId),
	],
)
