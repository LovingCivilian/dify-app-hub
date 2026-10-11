import { sql } from 'drizzle-orm'
import { datetime, json, mediumblob, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core'

/**
 * Instance settings (settings spec §3.2): one JSON document per area (`branding`; later `smtp`, `ldap`), parsed by the
 * area's zod schema on every read and write (Drizzle guide "Set empty array default in MySQL with json column":
 * `json().$type<T>()`). A row is written only while the area's mode is `database`. `updated_by` is the saving account's
 * id with no foreign key, so deleting that account keeps the record (as users.admin_deactivated_by, B3 spec §3.1).
 */
export const instanceSettings = mysqlTable('instance_settings', {
	area: varchar('area', { length: 32 }).primaryKey(),
	data: json('data').$type<unknown>().notNull(),
	updatedAt: datetime('updated_at', { fsp: 3 })
		.default(sql`CURRENT_TIMESTAMP(3)`)
		.notNull()
		.$onUpdate(() => new Date()),
	updatedBy: varchar('updated_by', { length: 36 }),
})

/**
 * An area's files (spec §3.2): branding's processed PNGs, in the database like the app icons (dify_apps.icon_image),
 * so several hub containers need no shared folder. Deleting the area's row deletes them (MySQL 8.4 "FOREIGN KEY
 * Constraints", ON DELETE CASCADE).
 */
export const instanceSettingFiles = mysqlTable(
	'instance_setting_files',
	{
		area: varchar('area', { length: 32 })
			.notNull()
			.references(() => instanceSettings.area, { onDelete: 'cascade' }),
		name: varchar('name', { length: 32 }).notNull(),
		bytes: mediumblob('bytes', { mode: 'buffer' }).notNull(),
		mime: varchar('mime', { length: 64 }).notNull(),
		updatedAt: datetime('updated_at', { fsp: 3 })
			.default(sql`CURRENT_TIMESTAMP(3)`)
			.notNull()
			.$onUpdate(() => new Date()),
	},
	table => [primaryKey({ columns: [table.area, table.name] })],
)
