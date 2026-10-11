import { bytea, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'

import { timestamptz } from './columns'

/**
 * Instance settings (settings spec §3.2): one JSON document per area (`branding`; later `smtp`, `ldap`), parsed by the
 * area's zod schema on every read and write. Stored as jsonb (PostgreSQL 18 "JSON Types": "most applications should
 * prefer to store JSON data as jsonb"); `.$type<unknown>()` is a type only (Drizzle "PostgreSQL column types", jsonb:
 * "it won't check runtime values"), so only a zod parse makes the value usable. A row is written only while the area's
 * mode is `database`. `updated_by` is the saving account's id with no foreign key, so deleting that account keeps the
 * record (as users.admin_deactivated_by, B3 spec §3.1).
 */
export const instanceSettings = pgTable('instance_settings', {
	area: text('area').primaryKey(),
	data: jsonb('data').$type<unknown>().notNull(),
	updatedAt: timestamptz('updated_at')
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
	updatedBy: uuid('updated_by'),
})

/**
 * An area's files (spec §3.2): branding's processed PNGs, in the database like the app icons (dify_apps.icon_image),
 * so several hub containers need no shared folder. Deleting the area's row deletes them (PostgreSQL 18 "Foreign Keys",
 * ON DELETE CASCADE); the primary key leads with `area`, which serves the foreign key.
 */
export const instanceSettingFiles = pgTable(
	'instance_setting_files',
	{
		area: text('area')
			.notNull()
			.references(() => instanceSettings.area, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		bytes: bytea('bytes').notNull(),
		mime: text('mime').notNull(),
		updatedAt: timestamptz('updated_at')
			.defaultNow()
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [primaryKey({ columns: [table.area, table.name] })],
)
