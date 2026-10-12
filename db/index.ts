import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import { env } from '@/lib/env'
import { logActionError } from '@/lib/error-log'

/**
 * One pool per process (Drizzle "Get started with PostgreSQL", node-postgres: `drizzle({ client: pool })`; DV 1a). An
 * idle client whose connection the server ends, as a PostgreSQL restart does, makes the pool emit `error`; "if a pool
 * emits an error event and no listeners are added node will emit an uncaught error and potentially crash your node
 * process", and the client "will be automatically terminated and removed from the pool" (node-postgres "Pool", events;
 * DV 1b). The listener logs it by name and code (lib/error-log.ts). drizzle-orm 1.0.0-rc.4's config has no `schema`
 * option (the relational API is typed over defineRelations), and the DAL uses the query builder with explicit columns.
 */
const createDb = () => {
	// node-postgres waits for a new connection without a limit by default ("Pool": connectionTimeoutMillis "By default
	// this is 0 which means no timeout"). 10 s keeps the bound the hub had on MySQL (mysql2's `connectTimeout`, 10,000 ms
	// by default), so a database that does not answer fails a request after 10 s, as ADR-0030 records for the login
	// page, instead of holding it (Part 0 spec §1: no other change in behaviour).
	const pool = new Pool({ connectionString: env().databaseUrl, connectionTimeoutMillis: 10_000 })
	pool.on('error', error => logActionError(error, 'Database pool'))
	return drizzle({ client: pool, logger: env().nodeEnv === 'development' })
}

export type Db = ReturnType<typeof createDb>

// In development the module is re-evaluated on edits, so the instance lives on globalThis (the inherited code did the
// same); in production the module loads once anyway.
const globalForDb = globalThis as unknown as { aiAppHubDb?: Db }

export const getDb = (): Db => (globalForDb.aiAppHubDb ??= createDb())
