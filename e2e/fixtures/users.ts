import { randomUUID } from 'node:crypto'

import { expect, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'

// Type-only and relative: erased at runtime, so the fixture loads none of the app's modules.
import type { Role } from '../../lib/auth/roles'

import { withDb } from './db'
import { waitForHydration } from './hydration'

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

/**
 * The login page shows the two tabs in the e2e suite (decision aa): local accounts sign in on "Local account". A click
 * that lands before React has hydrated the form does nothing (e2e/fixtures/hydration.ts), and choosing a tab is
 * idempotent, so the click is retried until the local form shows (Playwright "Assertions", `expect.toPass`; its
 * timeout defaults to 0, so it is given expect's).
 */
export const chooseLocalAccount = async (page: Page) => {
	await expect(async () => {
		await page.getByRole('tab', { name: 'Local account' }).click()
		await expect(page.getByLabel('Email')).toBeVisible({ timeout: 1_000 })
	}).toPass({ timeout: 30_000 })
}

/** Signs in through the login form's local tab and waits for the landing page. */
export const signInAs = async (page: Page, email: string, password: string) => {
	await page.goto('/login')
	await chooseLocalAccount(page)
	await page.getByLabel('Email').fill(email)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Log in' }).click()
	await expect(page).toHaveURL(/\/apps$/)
}

/**
 * Signs in through the directory tab, the login page's default (spec §6.3). That tab is already selected in the server
 * HTML, so it is no sign of hydration, and a "Log in" click before hydration would submit the native form instead
 * (e2e/fixtures/hydration.ts). The specs keep a test-side wait before their first click (owner, 2026-10-08): a tab
 * switch works only once React has hydrated and is idempotent, so the switch to the local tab and back is retried
 * until each tab's form shows (Playwright "Assertions", `expect.toPass`; its timeout defaults to 0, so it is given one).
 */
export const signInWithDirectory = async (page: Page, username: string, password: string) => {
	await page.goto('/login')
	await expect(page.getByRole('tab', { name: 'Directory account', selected: true })).toBeVisible()
	await chooseLocalAccount(page)
	await expect(async () => {
		await page.getByRole('tab', { name: 'Directory account' }).click()
		await expect(page.getByLabel('Username')).toBeVisible({ timeout: 1_000 })
	}).toPass({ timeout: 30_000 })
	await page.getByLabel('Username').fill(username)
	await page.getByLabel('Password').fill(password)
	await page.getByRole('button', { name: 'Log in' }).click()
}

/** Opens the users page and waits until its table has hydrated (the date in the table is the signal). */
export const openUsers = async (page: Page) => {
	await page.goto('/user-management')
	await waitForHydration(page.getByRole('table').locator('time').first())
}
