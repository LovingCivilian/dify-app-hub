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
