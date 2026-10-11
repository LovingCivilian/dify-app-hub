// __tests__/db/database.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

/** The live suite's own database in the e2e PostgreSQL; global-setup.ts recreates and migrates it before each run. */
export const HUB_DAL_URL = 'postgres://e2e:e2e@127.0.0.1:5433/hub_dal'

/**
 * One pool per test file (Vitest runs each file in its own module graph), ended by the file's afterAll. A pool opens
 * no connection before its first query (node-postgres "Pool": clients are created lazily).
 */
export const pool = new Pool({ connectionString: HUB_DAL_URL })

/** What the Data Access Layer's getDb() answers in this project: each test file mocks `@/db` with it. */
export const testDb = drizzle({ client: pool })

/**
 * Every table the hub writes, emptied with the rows that reference them (PostgreSQL 18 "TRUNCATE": CASCADE
 * "Automatically truncate all tables that have foreign-key references to any of the named tables").
 */
export const resetTables = async (): Promise<void> => {
	await pool.query(
		'TRUNCATE users, user_groups, dify_apps, directory_sync_runs, instance_settings, password_reset_tokens CASCADE',
	)
}
