import { expect, test } from '@playwright/test'

import {
	DIRECTORY_PASSWORD,
	deleteDirectoryAccount,
	directoryAccount,
	directoryAccountsByUsername,
} from './fixtures/directory'
import {
	chooseLocalAccount,
	deleteUsersLike,
	seedUser,
	signInWithDirectory,
} from './fixtures/users'

// Spec §8 "Playwright" (B3b): the tabs, a first directory sign-in, and the generic answer for every account-related
// refusal (spec §7.3). The directory's people are the smblds seed (e2e/fixtures/ldap/ad/entrypoint.d/20-seed.sh).
test.describe('directory sign-in (ADR-0029)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test.afterEach(async () => {
		await deleteDirectoryAccount('alice@e2e.hub.test')
		await deleteUsersLike('erin@e2e.hub.test')
	})

	test('shows the directory tab first and the local tab beside it', async ({ page }) => {
		await page.goto('/login')
		await expect(page.getByRole('tab', { name: 'Directory account', selected: true })).toBeVisible()
		await expect(page.getByLabel('Username')).toBeVisible()
		await expect(
			page.getByText(
				'Your username only, without the domain: jsmith, not CORP\\jsmith or jsmith@corp.example.com',
				{ exact: true },
			),
		).toBeVisible()
		// Decision y's forgot-password link (local tab only) is checked live with SMTP on; .env.e2e has it off (ADR-0010).
		await chooseLocalAccount(page)
		await expect(page.getByLabel('Username')).toHaveCount(0)
	})

	test('creates a directory account at the first sign-in, linked by its key, without a hub password', async ({
		page,
	}) => {
		await signInWithDirectory(page, 'alice', DIRECTORY_PASSWORD)
		await expect(page).toHaveURL(/\/apps$/)
		const account = await directoryAccount('alice@e2e.hub.test')
		expect(account).toMatchObject({
			source: 'ldap',
			role: 'user',
			password: null,
			directory_id_attribute: 'objectGUID',
			directory_username: 'alice',
		})
		expect(String(account!.directory_id)).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		)
		// Decision v: the account menu has no password change for a directory account.
		await page.getByRole('button', { name: /Signed in as/ }).click()
		await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Change password' })).toHaveCount(0)
	})

	// Review Focus 2: a directory account has no hub password, so its email and directory password on the local tab are
	// refused like any wrong password (spec §6.3).
	test('refuses a directory account on the local tab', async ({ page }) => {
		await signInWithDirectory(page, 'alice', DIRECTORY_PASSWORD)
		await expect(page).toHaveURL(/\/apps$/)
		await page.getByRole('button', { name: /Signed in as/ }).click()
		await page.getByRole('menuitem', { name: 'Log out' }).click()
		await expect(page).toHaveURL(/\/login$/)
		await chooseLocalAccount(page)
		await page.getByLabel('Email').fill('alice@e2e.hub.test')
		await page.getByLabel('Password').fill(DIRECTORY_PASSWORD)
		await page.getByRole('button', { name: 'Log in' }).click()
		await expect(page.getByText('Login failed. Check your email and password.')).toBeVisible()
		await expect(page).toHaveURL(/\/login/)
	})

	test.describe('answers every refusal with the same message (spec §7.3)', () => {
		const refused = 'Login failed. Check your username and password.'

		test('a wrong password', async ({ page }) => {
			await signInWithDirectory(page, 'alice', 'Not-the-Passw0rd')
			await expect(page.getByText(refused)).toBeVisible()
			await expect(page).toHaveURL(/\/login/)
		})

		test('an entry without an email', async ({ page }) => {
			await signInWithDirectory(page, 'dave', DIRECTORY_PASSWORD)
			await expect(page.getByText(refused)).toBeVisible()
			expect(await directoryAccountsByUsername('dave')).toEqual([])
		})

		test('a disabled directory account', async ({ page }) => {
			await signInWithDirectory(page, 'carol', DIRECTORY_PASSWORD)
			await expect(page.getByText(refused)).toBeVisible()
		})

		// Spec §2 #10 and §7.2: a local account's email is never taken over by a directory sign-in.
		test('an email a local account uses', async ({ page }) => {
			await seedUser({ email: 'erin@e2e.hub.test', password: 'local-pass-1', name: 'Local Erin' })
			await signInWithDirectory(page, 'erin', DIRECTORY_PASSWORD)
			await expect(page.getByText(refused)).toBeVisible()
			expect(await directoryAccount('erin@e2e.hub.test')).toMatchObject({
				source: 'local',
				directory_id: null,
			})
		})
	})
})
