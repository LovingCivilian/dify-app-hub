import mysql from 'mysql2/promise'

import { e2eEnv } from './env'

/**
 * One connection to the e2e MySQL for a spec's own rows. The suite's database survives between runs, so a
 * spec deletes what it created in `finally`.
 */
export const withDb = async <T>(fn: (db: mysql.Connection) => Promise<T>): Promise<T> => {
	const db = await mysql.createConnection(e2eEnv.DATABASE_URL)
	try {
		return await fn(db)
	} finally {
		await db.end()
	}
}
