import { expect, type Page, test } from '@playwright/test'

import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const openAccountMenu = (page: Page, email: string) =>
	page.getByRole('button', { name: `Signed in as ${email}` }).click()

test.describe('the account-menu password change (charter §4.6)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test.afterEach(async () => {
		await deleteUsersLike(`account-${test.info().project.name}%`)
	})

	test('refuses a wrong current password, then signs every session out and logs in with the new one', async ({
		page,
		browser,
	}, testInfo) => {
		const email = `account-${testInfo.project.name}@e2e.local`
		await seedUser({ email, password: 'old-password-1', name: 'Account user' })
		// A second browser signed in as the same account: the change must revoke it too (Review Focus 5).
		const other = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const otherPage = await other.newPage()
			await signInAs(otherPage, email, 'old-password-1')
			await signInAs(page, email, 'old-password-1')

			await openAccountMenu(page, email)
			await page.getByRole('menuitem', { name: 'Change password' }).click()
			const dialog = page.getByRole('dialog', { name: 'Change password' })
			await dialog.getByLabel('Current password').fill('wrong-password-1')
			await dialog.getByLabel('New password').fill('new-password-1')
			await dialog.getByLabel('Confirm password').fill('new-password-1')
			await dialog.getByRole('button', { name: 'Change password' }).click()
			await expect(dialog.getByText('The current password is incorrect')).toBeVisible()

			await dialog.getByLabel('Current password').fill('old-password-1')
			await dialog.getByRole('button', { name: 'Change password' }).click()
			await expect(page).toHaveURL(/\/login\?notice=password-changed$/)
			await expect(page.getByText('Password changed. Log in with your new password.')).toBeVisible()

			await page.getByLabel('Email').fill(email)
			await page.getByLabel('Password').fill('old-password-1')
			await page.getByRole('button', { name: 'Log in' }).click()
			await expect(page.getByText('Login failed. Check your email and password.')).toBeVisible()
			await page.getByLabel('Password').fill('new-password-1')
			await page.getByRole('button', { name: 'Log in' }).click()
			await expect(page).toHaveURL(/\/apps$/)

			await otherPage.goto('/apps')
			await expect(otherPage).toHaveURL(/\/login/)
		} finally {
			await other.close()
		}
	})
})
