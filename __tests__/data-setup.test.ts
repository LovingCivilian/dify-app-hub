import { drizzle } from 'drizzle-orm/mysql2'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/db', () => ({
	getDb: () => {
		throw new Error('not used by the SQL test')
	},
}))

import { lockAnyAccount } from '@/lib/data/setup'

describe('lockAnyAccount (decision d)', () => {
	it('is a locking read of any one account, so only an empty table lets first run through', () => {
		const query = lockAnyAccount(drizzle.mock()).toSQL()
		expect(query.sql).toBe('select `id` from `users` limit ? for update')
		expect(query.params).toEqual([1])
	})
})
