import { sql, type SQL } from 'drizzle-orm'
import {
	check,
	integer,
	pgTable,
	text,
	uniqueIndex,
	uuid,
	type AnyPgColumn,
} from 'drizzle-orm/pg-core'

import { generateUuidV4 } from '@/lib/helpers'

import { timestamptz } from './columns'
import { accountSource, userRole } from './enums'

/**
 * The expression the email index and every lookup by email share (Drizzle guide "Unique and Case-Insensitive Email
 * Handling", its `lower()` helper; PostgreSQL 18 "Indexes on Expressions": a unique index on `lower(col1)` "would
 * prevent creation of rows whose col1 values differ only in case"). A lookup puts it on both sides of the comparison
 * (PostgreSQL 18 "citext", Rationale). It folds case, not accents (ADR-0031).
 */
export const lower = (column: AnyPgColumn): SQL => sql`lower(${column})`

export const users = pgTable(
	'users',
	{
		id: uuid()
			.primaryKey()
			.$defaultFn(() => generateUuidV4()),
		name: text(),
		email: text().notNull(),
		/** The bcrypt hash of a local account; null for a directory account, whose password the directory checks (ADR-0029). */
		password: text(),
		/** ADR-0024: first run creates the owner; the owner manages admins and users, an admin manages users. */
		role: userRole().default('user').notNull(),
		sessionVersion: integer('session_version').default(0).notNull(),
		/** ADR-0027: set by an admin's Deactivate, cleared by Reactivate; the account is active while both markers are null. */
		adminDeactivatedAt: timestamptz('admin_deactivated_at'),
		/** The admin's users.id; no foreign key, so deleting that admin keeps the record. */
		adminDeactivatedBy: uuid('admin_deactivated_by'),
		/** ADR-0027: set and cleared by the directory sync and sign-in only (ADR-0029). */
		directoryDeactivatedAt: timestamptz('directory_deactivated_at'),
		/** ADR-0029: who owns the account's identity; a local account unless the directory sign-in made it. */
		source: accountSource().default('local').notNull(),
		/**
		 * The directory entry's key in canonical text (B3 spec §3.2: `objectGUID` as a lowercase GUID string, `entryUUID`
		 * lowercased), the only link to the entry (ADR-0026: never the email, the DN, the UPN or the login name).
		 */
		directoryId: text('directory_id'),
		/** The attribute that produced the key, so a change of LDAP_ID_ATTRIBUTE is detected (B3 spec §6.4 step 2). */
		directoryIdAttribute: text('directory_id_attribute'),
		/** The login attribute's value, for display and search. */
		directoryUsername: text('directory_username'),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
		updatedAt: timestamptz('updated_at')
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [
		// Emails are unique whatever their case (Part 0 spec §3.4).
		uniqueIndex('users_email_key').on(lower(table.email)),
		// "By default, null values in a unique column are not considered equal, allowing multiple nulls in the column"
		// (PostgreSQL 18 "Unique Indexes"), so every local account can have none.
		uniqueIndex('users_directory_id_key').on(table.directoryId),
		// One owner (ADR-0024), held by the database: a unique index over the owner rows only (PostgreSQL 18 "Partial
		// Indexes", Example 11.3 "Setting up a Partial Unique Index"; Drizzle "Indexes & Constraints", `.where()`). Two
		// first runs at once both find the table empty; the second owner's insert is refused (23505), which
		// lib/data/setup.ts answers as setup done (Part 0 spec §3.4).
		uniqueIndex('users_one_owner')
			.on(table.role)
			.where(sql`${table.role} = 'owner'`),
		// "A check constraint is satisfied if the check expression evaluates to true or the null value" (PostgreSQL 18
		// "Check Constraints"), so `source` is NOT NULL and the other columns are tested with IS [NOT] NULL, which never
		// yields null. An `ldap` row also names the attribute that produced its key (B3 spec §3.2), which the sync's
		// `id_attribute_changed` stop reads for every `ldap` account (B3 spec §6.4 step 2).
		check(
			'users_source_credentials',
			sql`(${table.source} = 'local' AND ${table.password} IS NOT NULL AND ${table.directoryId} IS NULL) OR (${table.source} = 'ldap' AND ${table.password} IS NULL AND ${table.directoryId} IS NOT NULL AND ${table.directoryIdAttribute} IS NOT NULL)`,
		),
	],
)
