import {
	datetime,
	index,
	int,
	mysqlEnum,
	mysqlTable,
	primaryKey,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/mysql-core'

import { SYNC_OUTCOMES, SYNC_TRIGGERS } from '@/lib/directory-status'

import { userGroups } from './groups'

/**
 * A hub group's link to a directory group, by the directory group's key (B3 spec §3.2, §6.5): renaming or moving the
 * group in the directory keeps the link. Deleting the hub group removes its links (ON DELETE CASCADE). The name is what
 * the groups page shows, refreshed by the sync; `missing_since` is set while the sync does not find the group.
 */
export const userGroupDirectoryLinks = mysqlTable(
	'user_group_directory_links',
	{
		groupId: varchar('group_id', { length: 36 })
			.notNull()
			.references(() => userGroups.id, { onDelete: 'cascade' }),
		directoryGroupId: varchar('directory_group_id', { length: 64 }).notNull(),
		directoryGroupName: varchar('directory_group_name', { length: 255 }).notNull(),
		missingSince: datetime('missing_since', { fsp: 3 }),
	},
	table => [primaryKey({ columns: [table.groupId, table.directoryGroupId] })],
)

/**
 * One row per sync run (spec §3.2, §6.4). `slot` is unique: a scheduled run's slot is its scheduled minute, so a second
 * container's insert for the same slot is refused and that container skips (Documenso's deterministic slot key). The
 * run deletes rows older than 90 days. `run_trigger`, not `trigger`, which MySQL 8.4 reserves.
 */
export const directorySyncRuns = mysqlTable(
	'directory_sync_runs',
	{
		id: varchar({ length: 36 }).primaryKey(),
		slot: varchar({ length: 64 }).notNull(),
		runTrigger: mysqlEnum('run_trigger', SYNC_TRIGGERS).notNull(),
		startedAt: datetime('started_at', { fsp: 3 }).notNull(),
		finishedAt: datetime('finished_at', { fsp: 3 }),
		outcome: mysqlEnum(SYNC_OUTCOMES).default('running').notNull(),
		entriesSeen: int('entries_seen').default(0).notNull(),
		deactivated: int('deactivated').default(0).notNull(),
		reactivated: int('reactivated').default(0).notNull(),
		updated: int('updated').default(0).notNull(),
		conflicts: int('conflicts').default(0).notNull(),
		groupErrors: int('group_errors').default(0).notNull(),
		membershipsAdded: int('memberships_added').default(0).notNull(),
		membershipsRemoved: int('memberships_removed').default(0).notNull(),
		errorCode: varchar('error_code', { length: 64 }),
	},
	table => [
		uniqueIndex('directory_sync_runs_slot_key').on(table.slot),
		index('directory_sync_runs_started_at_idx').on(table.startedAt),
	],
)
