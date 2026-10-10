import { expect, test } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'
import { DIRECTORY_PASSWORD, deleteDirectoryAccount, samba } from './fixtures/directory'
import { openUsers, signInWithDirectory } from './fixtures/users'

test.use({ storageState: ADMIN_STATE })

// Spec §8 "Playwright" (B3b): Sync now deactivates and signs out a removed entry and reactivates it when it returns;
// the status panel. bob is a person of the smblds seed; the test disables him in the directory and restores him.
test.describe('Sync now (spec §6.6)', () => {
	test.afterEach(async () => {
		samba(['user', 'enable', 'bob'])
		await deleteDirectoryAccount('bob@e2e.hub.test')
	})

	test('deactivates and signs out a disabled person, then reactivates them when enabled again', async ({
		page,
		browser,
	}) => {
		const bobContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const bobPage = await bobContext.newPage()
			await signInWithDirectory(bobPage, 'bob', DIRECTORY_PASSWORD)
			await expect(bobPage).toHaveURL(/\/apps$/)

			await openUsers(page)
			const panel = page.getByRole('region', { name: 'Directory sync' })
			await expect(panel.getByText('LDAPS', { exact: true })).toBeVisible()
			// .env.e2e sets LDAP_SYNC_SCHEDULE=off.
			await expect(panel.getByText('Off', { exact: true })).toBeVisible()

			samba(['user', 'disable', 'bob'])
			await panel.getByRole('button', { name: 'Sync now' }).click()
			await expect(page.getByText(/^Sync finished:/)).toBeVisible()
			await page.getByPlaceholder('Search users').fill('bob@e2e.hub.test')
			const row = page.getByRole('row', { name: /bob@e2e\.hub\.test/ })
			await expect(row.getByText('Not in directory', { exact: true })).toBeVisible()
			await expect(panel.getByText('Succeeded', { exact: true })).toBeVisible()
			// The directory's deactivation bumped sessionVersion: bob's open session ends at its next request.
			await bobPage.goto('/apps')
			await expect(bobPage).toHaveURL(/\/login/)

			samba(['user', 'enable', 'bob'])
			await panel.getByRole('button', { name: 'Sync now' }).click()
			await expect(row.getByText('Active', { exact: true })).toBeVisible()
			await signInWithDirectory(bobPage, 'bob', DIRECTORY_PASSWORD)
			await expect(bobPage).toHaveURL(/\/apps$/)
		} finally {
			await bobContext.close()
		}
	})
})
