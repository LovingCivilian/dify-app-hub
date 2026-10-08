import { randomUUID } from 'node:crypto'

import { expect, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'

// Type-only and relative: erased at runtime, so the fixture loads none of the app's modules.
import type { Role } from '../../lib/auth/roles'

import { withDb } from './db'

/**
 * An account written straight to the e2e MySQL with a bcrypt hash (charter §4.6: extra users through the
 * database fixture). Its email must carry the project name, and the spec deletes it in `finally` or `afterEach`.
 * A leftover row with the same email (a run killed before its clean-up) is deleted first, with its reset tokens,
 * so the insert does not hit the unique email index.
 */
export const seedUser = async ({
	email,
	password,
	name = null,
	role = 'user',
}: {
	email: string
	password: string
	name?: string | null
	role?: Role
}): Promise<string> => {
	const id = randomUUID()
	const hash = await bcrypt.hash(password, 10)
	await withDb(async db => {
		await db.execute(
			'DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ?)',
			[email],
		)
		await db.execute('DELETE FROM users WHERE email = ?', [email])
		await db.execute('INSERT INTO users (id, name, email, password, role) VALUES (?, ?, ?, ?, ?)', [
			id,
			name,
			email,
			hash,
			role,
		])
	})
	return id
}

/** Deletes the accounts whose email matches a LIKE pattern, and their reset tokens. */
export const deleteUsersLike = (pattern: string) =>
	withDb(async db => {
		await db.execute(
			'DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)',
			[pattern],
		)
		await db.execute('DELETE FROM users WHERE email LIKE ?', [pattern])
	})

/** Signs in through the login form and waits for the landing page. */
export const signInAs = async (page: Page, email: string, password: string) => {
	await page.goto('/login')
	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Log in' }).click()
	await expect(page).toHaveURL(/\/apps$/)
}
