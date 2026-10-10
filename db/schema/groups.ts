import { sql } from 'drizzle-orm'
import {
	datetime,
	mysqlEnum,
	mysqlTable,
	primaryKey,
	text,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/mysql-core'

import { MEMBERSHIP_SOURCES } from '@/lib/app-access'
import { generateUuidV4 } from '@/lib/helpers'

import { users } from './users'

/** Hub groups (B3 spec §3.1). `groups` is a reserved word in MySQL 8.4, hence `user_groups`. */
export const userGroups = mysqlTable(
	'user_groups',
	{
		id: varchar({ length: 36 })
			.primaryKey()
			.$defaultFn(() => generateUuidV4()),
		name: varchar({ length: 255 }).notNull(),
		description: text(),
		createdAt: datetime('created_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull(),
		updatedAt: datetime('updated_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [uniqueIndex('user_groups_name_key').on(table.name)],
)

/**
 * Memberships (spec §2 #8): a person can be a member by hand and through the directory at once, one row per source;
 * an admin changes only `manual` rows and the sync only `directory` rows. Deleting the group or the account removes
 * its rows (ON DELETE CASCADE, MySQL 8.4 "FOREIGN KEY Constraints").
 */
export const userGroupMembers = mysqlTable(
	'user_group_members',
	{
		groupId: varchar('group_id', { length: 36 })
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
		userId: varchar('user_id', { length: 36 })
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		source: mysqlEnum(MEMBERSHIP_SOURCES).notNull(),
		createdAt: datetime('created_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull(),
	},
	table => [primaryKey({ columns: [table.groupId, table.userId, table.source] })],
)
