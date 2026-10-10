import { sql } from 'drizzle-orm'
import {
	check,
	datetime,
	int,
	mysqlEnum,
	mysqlTable,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/mysql-core'

import { ACCOUNT_SOURCES } from '@/lib/auth/account-source'
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
		/** The bcrypt hash of a local account; null for a directory account, whose password the directory checks (ADR-0029). */
		password: varchar({ length: 255 }),
		/** ADR-0024: the migration made the oldest existing account the owner and every other one an admin. */
		role: mysqlEnum(ROLES).default('user').notNull(),
		sessionVersion: int('session_version').default(0).notNull(),
		/** ADR-0027: set by an admin's Deactivate, cleared by Reactivate; the account is active while both markers are null. */
		adminDeactivatedAt: datetime('admin_deactivated_at', { fsp: 3 }),
		/** The admin's users.id; no foreign key, so deleting that admin keeps the record. */
		adminDeactivatedBy: varchar('admin_deactivated_by', { length: 36 }),
		/** ADR-0027: set and cleared by the directory sync and sign-in only (ADR-0029). */
		directoryDeactivatedAt: datetime('directory_deactivated_at', { fsp: 3 }),
		/** ADR-0029: who owns the account's identity; existing accounts are local (the column default). */
		source: mysqlEnum(ACCOUNT_SOURCES).default('local').notNull(),
		/**
		 * The directory entry's key in canonical text (spec §3.2: `objectGUID` as a lowercase GUID string, `entryUUID`
		 * lowercased), the only link to the entry (ADR-0026: never the email, the DN, the UPN or the login name).
		 */
		directoryId: varchar('directory_id', { length: 64 }),
		/** The attribute that produced the key, so a change of LDAP_ID_ATTRIBUTE is detected (spec §6.4 step 2). */
		directoryIdAttribute: varchar('directory_id_attribute', { length: 64 }),
		/** The login attribute's value, for display and search. */
		directoryUsername: varchar('directory_username', { length: 255 }),
		createdAt: datetime('created_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull(),
		updatedAt: datetime('updated_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [
		uniqueIndex('users_email_key').on(table.email),
		// A unique index allows several NULLs (MySQL 8.4 "CREATE INDEX"), so every local account can have none.
		uniqueIndex('users_directory_id_key').on(table.directoryId),
		// MySQL 8.4 "CHECK Constraints": a NULL result passes, so `source` is NOT NULL and the other columns are tested
		// with IS [NOT] NULL, which never yields UNKNOWN. An `ldap` row also names the attribute that produced its key
		// (spec §3.2), which the sync's `id_attribute_changed` stop reads for every `ldap` account (spec §6.4 step 2).
		// A later migration that modifies `password`, `source`, `directory_id` or `directory_id_attribute` must drop and
		// re-add this constraint in the same statement ("ALTER TABLE").
		check(
			'users_source_credentials',
			sql`(${table.source} = 'local' AND ${table.password} IS NOT NULL AND ${table.directoryId} IS NULL) OR (${table.source} = 'ldap' AND ${table.password} IS NULL AND ${table.directoryId} IS NOT NULL AND ${table.directoryIdAttribute} IS NOT NULL)`,
		),
	],
)
