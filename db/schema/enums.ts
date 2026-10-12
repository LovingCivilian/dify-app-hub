import { pgEnum } from 'drizzle-orm/pg-core'

import { ACCESS_MODES, MEMBERSHIP_SOURCES } from '@/lib/app-access'
import { ACCOUNT_SOURCES } from '@/lib/auth/account-source'
import { ROLES } from '@/lib/auth/roles'
import { SYNC_OUTCOMES, SYNC_TRIGGERS } from '@/lib/directory-status'

/*
 * The hub's static value sets as PostgreSQL enum types (Drizzle "PostgreSQL column types", enum; PostgreSQL 18
 * "Enumerated Types": enums are "primarily intended for static sets of values"; decision 24). Two columns are called
 * `source` and hold different sets, so each type is named for its set. drizzle-kit reads enum types from the schema's
 * exports, as Drizzle's example exports `moodEnum`, so db/schema/index.ts exports these with the tables. A value added
 * later through `ALTER TYPE … ADD VALUE` "cannot be used until after the transaction has been committed" (PostgreSQL 18
 * "ALTER TYPE", Notes) and the migrator applies every pending migration in one transaction (DV 1d, 2e): a migration that
 * adds a value ships in a deploy where no migration uses it.
 */

export const userRole = pgEnum('user_role', ROLES)
export const accountSource = pgEnum('account_source', ACCOUNT_SOURCES)
export const accessMode = pgEnum('access_mode', ACCESS_MODES)
export const membershipSource = pgEnum('membership_source', MEMBERSHIP_SOURCES)
export const syncTrigger = pgEnum('sync_trigger', SYNC_TRIGGERS)
export const syncOutcome = pgEnum('sync_outcome', SYNC_OUTCOMES)
