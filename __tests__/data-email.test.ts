import { drizzle } from 'drizzle-orm/node-postgres'
import { describe, expect, it } from 'vitest'

import { users } from '@/db/schema'
import { emailMatches } from '@/lib/data/email'

describe('emailMatches (spec §3.4, ADR-0031)', () => {
	it('puts lower() on the column and on the value, in SQL, as the unique index users_email_key is built', () => {
		const query = drizzle
			.mock()
			.select({ id: users.id })
			.from(users)
			.where(emailMatches('Jane@Example.com'))
			.toSQL()
		expect(query.sql).toBe('select "id" from "users" where lower("users"."email") = lower($1)')
		// The value reaches PostgreSQL as typed; lower() folds it there, with the same rules as the index.
		expect(query.params).toEqual(['Jane@Example.com'])
	})
})
