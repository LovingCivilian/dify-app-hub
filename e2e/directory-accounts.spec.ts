import { expect, test } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'
import { drawerOpened } from './fixtures/drawer'
import { deleteUsersLike, openUsers, seedDirectoryUser } from './fixtures/users'

const tag = () => `dir-acct-${test.info().project.name}`
const email = (suffix: string) => `${tag()}-${suffix}@e2e.local`

test.use({ storageState: ADMIN_STATE })

// Spec §6.3 and §5: a directory account is read-only but for its role, shows its source, and the sync's marker.
test.describe('directory accounts on the users page (ADR-0029)', () => {
	test.afterEach(async () => {
		await deleteUsersLike(`${tag()}%`)
	})

	test('shows the source, edits the role only, and warns before a delete', async ({ page }) => {
		await seedDirectoryUser({ email: email('bob'), name: 'Bob Builder', username: 'bob.builder' })
		await openUsers(page)
		await page.getByPlaceholder('Search users').fill('bob.builder')
		const row = page.getByRole('row', { name: new RegExp(email('bob')) })
		await expect(row.getByText('Directory', { exact: true })).toBeVisible()
		await expect(row.getByText('bob.builder', { exact: true })).toBeVisible()

		await row.getByRole('button', { name: 'Edit' }).click()
		const drawer = page.getByRole('dialog', { name: 'Directory account' })
		await drawerOpened(drawer)
		await expect(drawer.getByText(email('bob'))).toBeVisible()
		// Name and email are text, not fields; there is no password field (spec §6.3).
		await expect(drawer.getByRole('textbox')).toHaveCount(0)
		await drawer.getByText('Admin', { exact: true }).click()
		await drawer.getByRole('button', { name: 'Update' }).click()
		await expect(page.getByText('User updated')).toBeVisible()
		await expect(row.getByText('Admin', { exact: true })).toBeVisible()

		await row.getByRole('button', { name: 'Delete' }).click()
		await expect(page.getByText(/gets a new account with a new Dify history/)).toBeVisible()
		await page.getByRole('button', { name: 'Cancel' }).last().click()
	})

	test('shows the directory marker with its date, and still offers Deactivate (decision ao)', async ({
		page,
	}) => {
		await seedDirectoryUser({
			email: email('carol'),
			name: 'Carol Gone',
			username: 'carol.gone',
			notInDirectorySince: new Date('2026-10-01T09:00:00Z'),
		})
		await openUsers(page)
		await page.getByPlaceholder('Search users').fill('carol.gone')
		const row = page.getByRole('row', { name: new RegExp(email('carol')) })
		const status = row.getByText('Not in directory', { exact: true })
		await expect(status).toBeVisible()
		await status.focus()
		await expect(page.getByRole('tooltip')).toContainText('Not found in the directory since')
		await status.blur()
		await expect(row.getByRole('button', { name: 'Deactivate' })).toBeVisible()
		await expect(row.getByRole('button', { name: 'Reactivate' })).toHaveCount(0)
	})
})
