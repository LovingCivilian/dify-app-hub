import { DatabaseError } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({
	env: () => ({ databaseUrl: 'postgres://hub:hub@127.0.0.1:1/hub', nodeEnv: 'test' }),
}))

import { getDb } from '@/db'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('the database pool (spec §3.1, DV 1b)', () => {
	it('is one pool per process', () => {
		expect(getDb()).toBe(getDb())
	})

	// Spec §1: nothing else changes. node-postgres has no connect timeout by default; mysql2 gave up after 10 s.
	it('gives up on a new connection after 10 s, as the MySQL driver did', () => {
		expect(getDb().$client.options.connectionTimeoutMillis).toBe(10_000)
	})

	// node-postgres "Pool", events: an idle client's error reaches the pool's `error` event, and "if a pool emits an
	// error event and no listeners are added node will emit an uncaught error and potentially crash your node process".
	// A PostgreSQL restart ends every idle connection with 57P01 (measured against postgres:18 while planning).
	it('keeps an idle client’s error from the process and logs it with its context', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
		const terminated = new DatabaseError(
			'terminating connection due to administrator command',
			0,
			'error',
		)
		terminated.code = '57P01'
		const pool = getDb().$client
		expect(pool.listenerCount('error')).toBe(1)
		expect(() => pool.emit('error', terminated)).not.toThrow()
		expect(logged).toHaveBeenCalledTimes(1)
		// By name and SQLSTATE only (lib/error-log.ts describeError), never the error itself.
		expect(logged).toHaveBeenCalledWith('Database pool:', { name: 'error', code: '57P01' })
	})
})
