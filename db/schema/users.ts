import { sql } from 'drizzle-orm'
import { datetime, int, mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core'

import { ROLES } from '@/lib/auth/roles'
import { generateUuidV4 } from '@/lib/helpers'

export const users = mysqlTable(
	'users',
	{
		id: varchar({ length: 36 })
			.primaryKey()
			.$defaultFn(() => generateUuidV4()),
		name: varchar({ length: 255 }),
		email: varchar({ length: 255 }).notNull(),
		password: varchar({ length: 255 }).notNull(),
		/** ADR-0024: the migration made the oldest existing account the owner and every other one an admin. */
		role: mysqlEnum(ROLES).default('user').notNull(),
		sessionVersion: int('session_version').default(0).notNull(),
		/** ADR-0027: set by an admin's Deactivate, cleared by Reactivate; the account is active while both markers are null. */
		adminDeactivatedAt: datetime('admin_deactivated_at', { fsp: 3 }),
		/** The admin's users.id; no foreign key, so deleting that admin keeps the record. */
		adminDeactivatedBy: varchar('admin_deactivated_by', { length: 36 }),
		/** ADR-0027: set and cleared by the directory sync and sign-in only (B3b). */
		directoryDeactivatedAt: datetime('directory_deactivated_at', { fsp: 3 }),
		createdAt: datetime('created_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull(),
		updatedAt: datetime('updated_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [uniqueIndex('users_email_key').on(table.email)],
)
