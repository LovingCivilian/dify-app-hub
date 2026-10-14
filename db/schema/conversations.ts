import { sql } from 'drizzle-orm'
import { bigint, check, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'

import { MESSAGE_ROLES, MESSAGE_STATUSES, RUN_STATUSES } from '@/lib/chat/statuses'

import { apps } from './apps'
import { timestamptz } from './columns'
import { users } from './users'

/*
 * The hub's conversation store (Part 2 spec §3.1, ADR-0033): one row per AG-UI thread, run and message, never an event
 * log (spec §3: the 1.0 spec replays history as messages; every reference hub stores messages). The value sets are the
 * code's own constants (lib/chat/statuses.ts), never input, so the CHECKs write them as literals with sql.raw, as
 * apps_provider_check does (PostgreSQL 18 "Check Constraints"; Drizzle "Indexes & Constraints", check()).
 *
 * `updated_at` is written by the data layer itself, never by `$onUpdate`: on a conversation it is the last activity
 * (spec §3.1), which a rename or a soft delete is not; and every value comes from a JS Date, so it has millisecond
 * precision and the list's keyset cursor (lib/data/conversations.ts) compares it exactly.
 */

/** The value list of a CHECK: `'a', 'b', …`. */
const listed = (values: readonly string[]) => sql.raw(values.map(value => `'${value}'`).join(', '))

/**
 * One per AG-UI thread (spec §3.1). The id is the threadId, minted by the hub (no default: lib/chat/run.ts gives it).
 * The indexes serve the user's list and, from 2c, the Logs; each foreign key's column leads one of them (PostgreSQL 18
 * "Foreign Keys": "it is often a good idea to index the referencing columns too").
 */
export const conversations = pgTable(
	'conversations',
	{
		id: uuid().primaryKey(),
		appId: uuid('app_id')
			.notNull()
			.references(() => apps.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		/** The first user message, trimmed to 80 characters, until renamed; '' when it had no text (spec §3.1). */
		title: text().default('').notNull(),
		/** The agent's shared state after the last run (AG-UI "State"): any JSON value. */
		state: jsonb().default({}).notNull(),
		/** One active run per conversation (spec §3.2 step 1); no foreign key, the run row may be written after it. */
		activeRunId: uuid('active_run_id'),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
		updatedAt: timestamptz('updated_at').defaultNow().notNull(),
		/** The soft delete (decision 49): set by the user's delete, purged after 30 days (spec §3.4). */
		deletedAt: timestamptz('deleted_at'),
	},
	table => [
		index('conversations_user_id_app_id_updated_at_idx').on(
			table.userId,
			table.appId,
			table.updatedAt,
		),
		index('conversations_app_id_updated_at_idx').on(table.appId, table.updatedAt),
	],
)

/** One per AG-UI run (spec §3.1): the id is the runId, minted by the hub and never reused. */
export const conversationRuns = pgTable(
	'conversation_runs',
	{
		id: uuid().primaryKey(),
		conversationId: uuid('conversation_id')
			.notNull()
			.references(() => conversations.id, { onDelete: 'cascade' }),
		/** `enum` types the column in TypeScript only; the CHECK refuses other values (db/schema/apps.ts). */
		status: text({ enum: RUN_STATUSES }).notNull(),
		/** RUN_FINISHED.outcome as received (interrupts). */
		outcome: jsonb(),
		/** The answers this run was started with (spec §6), kept for the Logs. */
		resume: jsonb(),
		/** `{ code, message }` from RUN_ERROR or the hub. */
		error: jsonb(),
		/** The terminal event's usage. */
		usage: jsonb(),
		/** The run's CUSTOM events `{ name, value }` (e.g. run_cancelled), never sent back to the agent. */
		custom: jsonb().default([]).notNull(),
		startedAt: timestamptz('started_at').defaultNow().notNull(),
		finishedAt: timestamptz('finished_at'),
	},
	table => [
		index('conversation_runs_conversation_id_started_at_idx').on(
			table.conversationId,
			table.startedAt,
		),
		check('conversation_runs_status_check', sql`${table.status} IN (${listed(RUN_STATUSES)})`),
	],
)

/**
 * One per AG-UI message (spec §3.1). `seq` is the transcript's order: timestamps tie inside a transaction
 * (`part2-store-and-logs.md` §6.2), and an identity column numbers rows as they are written (PostgreSQL 18
 * "CREATE TABLE", GENERATED ALWAYS AS IDENTITY; Drizzle "PostgreSQL column types", identity columns). `bigint` in
 * `mode: 'number'`: JavaScript numbers are exact up to 2^53, far past any row count here. `run_id` is set to NULL if
 * its run row goes (spec §3.1); runs go only with their conversation, but the action still needs the referencing
 * column indexed (PostgreSQL 18 "Foreign Keys"), hence `conversation_messages_run_id_idx`, which spec §3.1 does not
 * list (plan note). The UNIQUE key is what the upsert of lib/data/conversations.ts targets (PostgreSQL 18 "INSERT",
 * ON CONFLICT), and its leading column also serves the conversation's foreign key.
 */
export const conversationMessages = pgTable(
	'conversation_messages',
	{
		seq: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		conversationId: uuid('conversation_id')
			.notNull()
			.references(() => conversations.id, { onDelete: 'cascade' }),
		/** The run that produced it; a user message: the run it started. */
		runId: uuid('run_id').references(() => conversationRuns.id, { onDelete: 'set null' }),
		/** The AG-UI message id. */
		messageId: text('message_id').notNull(),
		role: text({ enum: MESSAGE_ROLES }).notNull(),
		/** The AG-UI message, checked with @ag-ui/core's MessageSchema on every write and read (lib/data/conversations.ts). */
		body: jsonb().notNull(),
		status: text({ enum: MESSAGE_STATUSES }).notNull(),
		createdAt: timestamptz('created_at').defaultNow().notNull(),
		updatedAt: timestamptz('updated_at').defaultNow().notNull(),
	},
	table => [
		unique('conversation_messages_conversation_id_message_id_key').on(
			table.conversationId,
			table.messageId,
		),
		index('conversation_messages_conversation_id_seq_idx').on(table.conversationId, table.seq),
		index('conversation_messages_run_id_idx').on(table.runId),
		check('conversation_messages_role_check', sql`${table.role} IN (${listed(MESSAGE_ROLES)})`),
		check(
			'conversation_messages_status_check',
			sql`${table.status} IN (${listed(MESSAGE_STATUSES)})`,
		),
	],
)
