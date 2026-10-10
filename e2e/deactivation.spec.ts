import { expect, test } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'
import { deleteUsersLike, openUsers, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'deact-pass-1'
const tag = () => `deact-${test.info().project.name}`
const email = () => `${tag()}@e2e.local`

test.use({ storageState: ADMIN_STATE })

// Review Focus 5: an open session ends at its next request, sign-in answers like a wrong password, and
// reactivation lets the account sign in again (old tokens stay revoked).
test.describe('deactivation (B3 spec §5)', () => {
	test.beforeEach(async () => {
		await seedUser({ email: email(), password: PASSWORD, name: 'Deactivated user' })
	})
	test.afterEach(async () => {
		await deleteUsersLike(`${tag()}%`)
	})

	test('signs a user out, blocks sign-in until reactivation, then lets it back in', async ({
		page,
		browser,
	}) => {
		const userContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const userPage = await userContext.newPage()
			await signInAs(userPage, email(), PASSWORD)
			// The session cookie as it stands before the deactivation, to replay after the reactivation.
			const signedInState = await userContext.storageState()

			await openUsers(page)
			await page.getByPlaceholder('Search users').fill(email())
			const row = page.getByRole('row', { name: new RegExp(email()) })
			await row.getByRole('button', { name: 'Deactivate' }).click()
			await page.getByRole('button', { name: 'Deactivate', exact: true }).last().click()
			await expect(page.getByText('Account deactivated')).toBeVisible()
			await expect(row.getByText('Deactivated', { exact: true })).toBeVisible()

			await userPage.goto('/apps')
			await expect(userPage).toHaveURL(/\/login/)
			await userPage.getByLabel('Email').fill(email())
			await userPage.getByLabel('Password').fill(PASSWORD)
			await userPage.getByRole('button', { name: 'Log in' }).click()
			await expect(userPage.getByText('Login failed. Check your email and password.')).toBeVisible()

			await row.getByRole('button', { name: 'Reactivate' }).click()
			await page.getByRole('button', { name: 'Reactivate', exact: true }).last().click()
			await expect(page.getByText('Account reactivated')).toBeVisible()
			await expect(row.getByText('Active', { exact: true })).toBeVisible()

			// The token from before the deactivation stays revoked: its sessionVersion is behind the row's.
			const oldContext = await browser.newContext({ storageState: signedInState })
			try {
				const oldPage = await oldContext.newPage()
				await oldPage.goto('/apps')
				await expect(oldPage).toHaveURL(/\/login/)
			} finally {
				await oldContext.close()
			}

			await signInAs(userPage, email(), PASSWORD)
		} finally {
			await userContext.close()
		}
	})

	test('offers no Deactivate on the owner’s own row', async ({ page }) => {
		await openUsers(page)
		const own = page.getByRole('row', { name: /E2E Owner/ })
		await expect(own.getByRole('button', { name: 'Edit' })).toBeVisible()
		await expect(own.getByRole('button', { name: 'Deactivate' })).toHaveCount(0)
	})
})
