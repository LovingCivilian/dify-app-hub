import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { withDb } from './fixtures/db'

test.describe('the single owner (ADR-0031)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	/*
	 * PostgreSQL 18 "Partial Indexes", Example 11.3: users_one_owner is unique on role where role = 'owner', so the
	 * database itself refuses a second owner, whichever path writes it. On this database the first-run path never
	 * reaches the insert (an account exists, so createOwner answers `forbidden` first); the concurrent first runs are
	 * proven against an empty database in __tests__/db/owner.db.test.ts (Task 7). The case touches the shared database
	 * only and opens no page: the three projects use one database one after another (workers: 1), so it runs once.
	 */
	test('refuses a second owner at the database', async () => {
		test.skip(
			test.info().project.name !== 'desktop-light',
			'a database-only case runs in one project',
		)
		const email = `second-owner-${randomUUID()}@e2e.local`
		try {
			const insert = withDb(db =>
				db.query(
					"INSERT INTO users (id, name, email, password, role) VALUES ($1, 'Second owner', $2, 'not-a-hash', 'owner')",
					[randomUUID(), email],
				),
			)
			// node-postgres rejects with its DatabaseError, which carries the SQLSTATE and the index's name (PostgreSQL 18
			// Appendix A: 23505 unique_violation).
			await expect(insert).rejects.toMatchObject({ code: '23505', constraint: 'users_one_owner' })
		} finally {
			await withDb(db => db.query('DELETE FROM users WHERE email = $1', [email]))
		}
	})

	// Part 0 spec §6: the first-run page is closed on a set-up database; its server redirect answers 307 to /login.
	test('/init answers 307 to /login once an owner exists', async ({ request }) => {
		const response = await request.get('/init', { maxRedirects: 0 })
		expect(response.status()).toBe(307)
		expect(response.headers().location).toMatch(/\/login$/)
	})
})
