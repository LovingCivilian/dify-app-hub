import { Client } from 'pg'

import { e2eEnv } from './env'

/**
 * One connection to the e2e PostgreSQL for a spec's own rows (node-postgres "Client": `connect()`, `query(text,
 * values)` with `$1` placeholders, `end()`). The suite's database survives between runs, so a spec deletes what it
 * created in `finally`.
 */
export const withDb = async <T>(fn: (db: Client) => Promise<T>): Promise<T> => {
	const db = new Client({ connectionString: e2eEnv.DATABASE_URL })
	await db.connect()
	try {
		return await fn(db)
	} finally {
		await db.end()
	}
}
