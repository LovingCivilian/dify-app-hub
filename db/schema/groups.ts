import { index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { generateUuidV4 } from '@/lib/helpers'

import { timestamptz } from './columns'
import { membershipSource } from './enums'
import { lower, users } from './users'

/**
 * Hub groups (B3 spec §3.1); `user_groups`, the name the MySQL schema gave them because MySQL reserves `groups`. Names
 * are unique whatever their case, as MySQL's case-insensitive collation kept them (`__tests__/group-management-actions.test.ts`
 * pins "Finance" against "finance"): a unique index on `lower(name)` (PostgreSQL 18 "Indexes on Expressions"; Part 0
 * Plan decision e). It folds case, not accents (ADR-0031).
 */
export const userGroups = pgTable(
	'user_groups',
	{
		id: uuid()
			.primaryKey()
			.$defaultFn(() => generateUuidV4()),
		name: text().notNull(),
		description: text(),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
		updatedAt: timestamptz('updated_at')
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [uniqueIndex('user_groups_name_key').on(lower(table.name))],
)

/**
 * Memberships (B3 spec §2 #8): a person can be a member by hand and through the directory at once, one row per source;
 * an admin changes only `manual` rows and the sync only `directory` rows. Deleting the group or the account removes its
 * rows (PostgreSQL 18 "Foreign Keys", ON DELETE CASCADE). The primary key leads with `group_id`; `user_id` gets its own
 * index, which PostgreSQL does not create for a foreign key (Part 0 spec §3.2): an account's delete and the sign-in's
 * lookup by account read it.
 */
export const userGroupMembers = pgTable(
	'user_group_members',
	{
		groupId: uuid('group_id')
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		source: membershipSource().notNull(),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
	},
	table => [
		primaryKey({ columns: [table.groupId, table.userId, table.source] }),
		index('user_group_members_user_id_idx').on(table.userId),
	],
)
