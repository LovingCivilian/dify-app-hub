import { sql } from 'drizzle-orm'
import { boolean, bytea, check, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { generateUuidV4 } from '@/lib/helpers'
import { PROVIDER_IDS } from '@/lib/providers/ids'

import { timestamptz } from './columns'
import { accessMode } from './enums'

/**
 * An app of any provider (Part 1 spec §2.1; decisions 17 and 24). The provider is `text` with a CHECK listing the known
 * ids, not an enum: a value added to an enum "cannot be used until after the transaction has been committed" while the
 * migrator applies every pending migration in one transaction, and the provider set is meant to grow (DV 2e); the
 * reference hubs store it as a string too (DV 11). The two documents are untyped jsonb (`unknown`, DV 8a): only their
 * provider's zod schemas make them usable (lib/providers/schemas.ts, on every write and read). The secrets sit apart from
 * the settings so the later encryption touches them alone (decision 8). The icon is an upload re-encoded to PNG (spec
 * §4.4) or an image Part 0 stored, which keeps its type (the icon route serves it with `nosniff` and a sandbox CSP);
 * both columns set or both NULL.
 */
export const apps = pgTable(
	'apps',
	{
		id: uuid()
			.primaryKey()
			.$defaultFn(() => generateUuidV4()),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
		updatedAt: timestamptz('updated_at')
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
		/** Fixed at insert (spec §2.3). `enum` types the column in TypeScript only (DV 2e); the CHECK refuses other values. */
		provider: text({ enum: PROVIDER_IDS }).notNull(),
		name: text().notNull(),
		description: text().default('').notNull(),
		/** A JSON array of strings (PostgreSQL 18 "JSON Types"); lib/data/apps.ts parseTags keeps the strings only. */
		tags: jsonb().default([]).notNull(),
		isEnabled: boolean('is_enabled').default(true).notNull(),
		/** B3 spec §2 #9: a new app is closed until granted. */
		accessMode: accessMode('access_mode').default('restricted').notNull(),
		settings: jsonb().notNull(),
		secrets: jsonb().notNull(),
		/** PostgreSQL 18 "Binary Data Types" (DV 2c); Drizzle's bytea reads and writes a Buffer. */
		iconImage: bytea('icon_image'),
		iconMime: text('icon_mime'),
	},
	table => [
		// PostgreSQL 18 "Check Constraints"; Drizzle "Indexes & Constraints", check(). The ids are the code's own constants,
		// never input, so they are written into the SQL as literals (sql.raw). Part 2 adds 'agui' through PROVIDER_IDS.
		check(
			'apps_provider_check',
			sql`${table.provider} IN (${sql.raw(PROVIDER_IDS.map(id => `'${id}'`).join(', '))})`,
		),
		check('apps_icon_check', sql`(${table.iconImage} IS NULL) = (${table.iconMime} IS NULL)`),
	],
)
