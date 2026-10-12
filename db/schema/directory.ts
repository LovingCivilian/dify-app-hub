import { index, integer, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { timestamptz } from './columns'
import { syncOutcome, syncTrigger } from './enums'
import { userGroups } from './groups'

/**
 * A hub group's link to a directory group, by the directory group's key (B3 spec §3.2, §6.5): renaming or moving the
 * group in the directory keeps the link. Deleting the hub group removes its links (ON DELETE CASCADE); the primary key
 * leads with `group_id`, which serves the foreign key. The name is what the groups page shows, refreshed by the sync;
 * `missing_since` is set while the sync does not find the group.
 */
export const userGroupDirectoryLinks = pgTable(
	'user_group_directory_links',
	{
		groupId: uuid('group_id')
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
		directoryGroupId: text('directory_group_id').notNull(),
		directoryGroupName: text('directory_group_name').notNull(),
		missingSince: timestamptz('missing_since'),
	},
	table => [primaryKey({ columns: [table.groupId, table.directoryGroupId] })],
)

/**
 * One row per sync run (B3 spec §3.2, §6.4). `slot` is unique: a scheduled run's slot is its scheduled minute, so a
 * second container's claim of the same slot is skipped and that container skips the run (Documenso's deterministic slot
 * key). The run deletes rows older than 90 days. The id is the run's own uuid, made by the scheduler. `run_trigger` is
 * the name the MySQL schema gave the column, because MySQL reserves `trigger`.
 */
export const directorySyncRuns = pgTable(
	'directory_sync_runs',
	{
		id: uuid().primaryKey(),
		slot: text().notNull(),
		runTrigger: syncTrigger('run_trigger').notNull(),
		startedAt: timestamptz('started_at').notNull(),
		finishedAt: timestamptz('finished_at'),
		outcome: syncOutcome().default('running').notNull(),
		entriesSeen: integer('entries_seen').default(0).notNull(),
		deactivated: integer('deactivated').default(0).notNull(),
		reactivated: integer('reactivated').default(0).notNull(),
		updated: integer('updated').default(0).notNull(),
		conflicts: integer('conflicts').default(0).notNull(),
		groupErrors: integer('group_errors').default(0).notNull(),
		membershipsAdded: integer('memberships_added').default(0).notNull(),
		membershipsRemoved: integer('memberships_removed').default(0).notNull(),
		errorCode: text('error_code'),
	},
	table => [
		uniqueIndex('directory_sync_runs_slot_key').on(table.slot),
		index('directory_sync_runs_started_at_idx').on(table.startedAt),
	],
)
