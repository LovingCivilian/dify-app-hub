import { sql } from 'drizzle-orm'
import {
	boolean,
	datetime,
	mediumblob,
	mysqlEnum,
	mysqlTable,
	text,
	varchar,
} from 'drizzle-orm/mysql-core'

import { ACCESS_MODES } from '@/lib/app-access'
import { generateUuidV4 } from '@/lib/helpers'

export const difyApps = mysqlTable('dify_apps', {
	id: varchar({ length: 36 })
		.primaryKey()
		.$defaultFn(() => generateUuidV4()),
	createdAt: datetime('created_at', { fsp: 3 })
		.default(sql`CURRENT_TIMESTAMP(3)`)
		.notNull(),
	updatedAt: datetime('updated_at', { fsp: 3 })
		.default(sql`CURRENT_TIMESTAMP(3)`)
		.notNull()
		.$onUpdate(() => new Date()),
	name: varchar({ length: 255 }).notNull(),
	/** A Dify app mode (lib/dify/types APP_MODES); kept free so a future mode does not break the row (charter §4.4). */
	mode: varchar({ length: 255 }),
	description: text(),
	/** JSON array of strings. */
	tags: text(),
	isEnabled: boolean('is_enabled').default(true).notNull(),
	/** B3 spec §2 #9: a new app is closed until granted; the B3a migration opened every existing app to everyone. */
	accessMode: mysqlEnum('access_mode', ACCESS_MODES).default('restricted').notNull(),
	apiBase: varchar('api_base', { length: 500 }).notNull(),
	apiKey: varchar('api_key', { length: 255 }).notNull(),
	enableAnswerForm: boolean('enable_answer_form').default(false).notNull(),
	answerFormFeedbackText: text('answer_form_feedback_text'),
	enableUpdateInputAfterStarts: boolean('enable_update_input_after_starts')
		.default(false)
		.notNull(),
	openingStatementDisplayMode: varchar('opening_statement_display_mode', { length: 20 }),
	enableAnnotation: boolean('enable_annotation').default(false).notNull(),
	// The Dify site icon, stored at create and sync time (charter §4.4): Dify's icon_url for an image expires.
	iconType: varchar('icon_type', { length: 16 }),
	icon: text('icon'),
	iconBackground: varchar('icon_background', { length: 32 }),
	iconImage: mediumblob('icon_image', { mode: 'buffer' }),
	iconMime: varchar('icon_mime', { length: 64 }),
})
