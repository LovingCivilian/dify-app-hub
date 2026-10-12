import { boolean, bytea, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { generateUuidV4 } from '@/lib/helpers'

import { timestamptz } from './columns'
import { accessMode } from './enums'

export const difyApps = pgTable('dify_apps', {
	id: uuid()
		.primaryKey()
		.$defaultFn(() => generateUuidV4()),
	createdAt: timestamptz('created_at').defaultNow().notNull(),
	updatedAt: timestamptz('updated_at')
		.defaultNow()
		.notNull()
		.$onUpdate(() => new Date()),
	name: text().notNull(),
	/** A Dify app mode (lib/providers/dify/types APP_MODES); kept free so a future mode does not break the row (charter §4.4). */
	mode: text(),
	description: text(),
	/**
	 * A JSON array of strings (PostgreSQL 18 "JSON Types": "most applications should prefer to store JSON data as
	 * jsonb"). Untyped on purpose (`unknown`, DV 8a): lib/data/apps.ts parseTags keeps the strings only.
	 */
	tags: jsonb(),
	isEnabled: boolean('is_enabled').default(true).notNull(),
	/** B3 spec §2 #9: a new app is closed until granted. */
	accessMode: accessMode('access_mode').default('restricted').notNull(),
	apiBase: text('api_base').notNull(),
	apiKey: text('api_key').notNull(),
	enableAnswerForm: boolean('enable_answer_form').default(false).notNull(),
	answerFormFeedbackText: text('answer_form_feedback_text'),
	enableUpdateInputAfterStarts: boolean('enable_update_input_after_starts')
		.default(false)
		.notNull(),
	openingStatementDisplayMode: text('opening_statement_display_mode'),
	enableAnnotation: boolean('enable_annotation').default(false).notNull(),
	// The Dify site icon, stored at create and sync time (charter §4.4): Dify's icon_url for an image expires.
	iconType: text('icon_type'),
	icon: text('icon'),
	iconBackground: text('icon_background'),
	/** PostgreSQL 18 "Binary Data Types" (DV 2c); Drizzle's bytea reads and writes a Buffer. */
	iconImage: bytea('icon_image'),
	iconMime: text('icon_mime'),
})
