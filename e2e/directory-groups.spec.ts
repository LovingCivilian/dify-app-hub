import { expect, test, type Page } from '@playwright/test'
import type { RowDataPacket } from 'mysql2/promise'

import { deleteApp, deleteGroupsLike, grantAppToGroup, seedApp } from './fixtures/access'
import { ADMIN_STATE } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { DIRECTORY_PASSWORD, deleteDirectoryAccount } from './fixtures/directory'
import { drawerOpened } from './fixtures/drawer'
import { waitForHydration } from './fixtures/hydration'
import { signInWithDirectory } from './fixtures/users'

const tag = () => `dir-link-${test.info().project.name}`

test.use({ storageState: ADMIN_STATE })

/**
 * Opens the groups page's add drawer. The table may be empty, so the page has no hydration-only signal, and a click
 * that lands before hydration does nothing (e2e/fixtures/hydration.ts): the click is retried until the drawer shows
 * (Playwright "Assertions", `expect.toPass`, whose timeout defaults to 0; the pattern of the groups navigation test in
 * e2e/admin-groups.spec.ts). `isVisible()` does not wait, so a drawer already opening is not clicked through.
 */
const openAddDrawer = async (page: Page) => {
	await page.goto('/group-management')
	const drawer = page.getByRole('dialog', { name: 'Add group' })
	await expect(async () => {
		if (!(await drawer.isVisible())) await page.getByRole('button', { name: 'Add group' }).click()
		await expect(drawer).toBeVisible({ timeout: 2_000 })
	}).toPass({ timeout: 30_000 })
	await drawerOpened(drawer)
	return drawer
}

// Spec §8 "Playwright" (B3b): "a link to a nested AD group grants an app". bob is in hub-backend, which is in
// hub-engineering (e2e/fixtures/ldap/ad/entrypoint.d/20-seed.sh); the hub group links hub-engineering.
test.describe('directory groups on the groups page (spec §6.5)', () => {
	let appId: string | undefined
	test.afterEach(async () => {
		if (appId) await deleteApp(appId)
		appId = undefined
		await deleteGroupsLike(`${tag()}%`)
		await deleteDirectoryAccount('bob@e2e.hub.test')
	})

	test('links a parent directory group; a member of its nested group gets the granted app at sign-in', async ({
		page,
		browser,
	}) => {
		const drawer = await openAddDrawer(page)
		await drawer.getByLabel('Name').fill(tag())
		await drawer.getByLabel('Directory groups').fill('engin')
		await page.getByTitle('hub-engineering', { exact: true }).click()
		await drawer.getByRole('button', { name: 'Add', exact: true }).click()
		await expect(page.getByText('Group added')).toBeVisible()
		const row = page.getByRole('row', { name: new RegExp(tag()) })
		await expect(row.getByText('hub-engineering', { exact: true })).toBeVisible()

		const groupId = await withDb(async db => {
			const [rows] = await db.execute<RowDataPacket[]>(
				'SELECT id FROM user_groups WHERE name = ?',
				[tag()],
			)
			return String(rows[0]!.id)
		})
		appId = await seedApp({ name: `${tag()} app`, accessMode: 'restricted' })
		await grantAppToGroup(appId, groupId)

		const bobContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const bobPage = await bobContext.newPage()
			await signInWithDirectory(bobPage, 'bob', DIRECTORY_PASSWORD)
			await expect(bobPage).toHaveURL(/\/apps$/)
			await expect(bobPage.getByText(`${tag()} app`)).toBeVisible()
		} finally {
			await bobContext.close()
		}

		// The sign-in wrote bob's directory membership; the drawer lists it read-only (spec §4.3).
		await page.reload()
		// A date in the row renders only after hydration (e2e/fixtures/hydration.ts), so Edit is live.
		await waitForHydration(row.locator('time'))
		await row.getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog', { name: 'Edit group' })
		await drawerOpened(edit)
		await expect(edit.getByText(/Bob Builder/)).toBeVisible()
		// Exact: the directory groups hint also says "the directory members" (getByText matches substrings).
		await expect(edit.getByText('Directory members', { exact: true })).toBeVisible()
	})

	// Decision al: under two characters the field asks for more (the route's unit test pins that such a text never
	// reaches the directory).
	test('a short search asks for at least two characters', async ({ page }) => {
		const drawer = await openAddDrawer(page)
		await drawer.getByLabel('Directory groups').fill('e')
		await expect(
			page.getByText('Type at least two characters to search the directory'),
		).toBeVisible()
		await drawer.getByRole('button', { name: 'Cancel' }).click()
	})
})
