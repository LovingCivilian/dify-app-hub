import { expect, test, type Page } from '@playwright/test'
import type { RowDataPacket } from 'mysql2/promise'

import { deleteApp, deleteGroupsLike, grantAppToGroup, seedApp, seedGroup } from './fixtures/access'
import { ADMIN_STATE } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { waitForHydration } from './fixtures/hydration'
import { deleteUsersLike, openUsers, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'groups-pass-1'
const tag = () => `grp-${test.info().project.name}`
const groupName = () => `Group ${tag()}`
const email = () => `${tag()}@e2e.local`

test.use({ storageState: ADMIN_STATE })

/**
 * Opens the groups page and waits until its table has hydrated: the spec seeds a group in beforeEach, so the table
 * renders a ClientDateTime, whose text appears only after hydration (see fixtures/hydration.ts).
 */
const openGroups = async (page: Page) => {
	await page.goto('/group-management')
	await expect(page.getByRole('heading', { name: 'Group management' })).toBeVisible()
	await waitForHydration(page.getByRole('table').locator('time').first())
}

/**
 * Opens the drawer's member picker, narrows it by the account's email and picks the option by its title (antd Select
 * options carry a title; the pattern of e2e/chat-hitl.spec.ts).
 */
const pickMember = async (page: Page, label: string, filter: string) => {
	await page.getByLabel('Members').fill(filter)
	await page.getByTitle(label, { exact: true }).click()
	await expect(
		page.getByRole('dialog').locator('.ant-select-selection-item', { hasText: label }),
	).toBeVisible()
}

test.describe('the groups page (B3 spec §4.3)', () => {
	test.beforeEach(async () => {
		await deleteGroupsLike(`%${tag()}%`)
		await seedGroup({ name: `Seed ${tag()}` })
		await seedUser({ email: email(), password: PASSWORD, name: 'Group member' })
	})
	test.afterEach(async () => {
		await deleteGroupsLike(`%${tag()}%`)
		await deleteUsersLike(`${tag()}%`)
	})

	test('creates a group with a member, renames it, refuses a duplicate name and deletes it', async ({
		page,
	}) => {
		await openGroups(page)
		await page.getByRole('button', { name: 'Add group' }).click()
		await page.getByLabel('Name').fill(groupName())
		await pickMember(page, `Group member (${email()})`, email())
		await page.getByRole('button', { name: 'Add', exact: true }).click()
		await expect(page.getByText('Group added')).toBeVisible()
		const row = page.getByRole('row', { name: new RegExp(groupName()) })
		await expect(row.getByRole('cell', { name: '1', exact: true })).toBeVisible()

		// Spec §4.3: the users table shows each account's groups as read-only tags (listUsers' membership join).
		const usersPage = await page.context().newPage()
		await openUsers(usersPage)
		const memberRow = usersPage.getByRole('row', { name: new RegExp(email()) })
		await expect(memberRow.getByText(groupName(), { exact: true })).toBeVisible()
		await usersPage.close()

		await row.getByRole('button', { name: 'Edit' }).click()
		await page.getByLabel('Name').fill(`${groupName()} renamed`)
		await page.getByRole('button', { name: 'Update' }).click()
		await expect(page.getByText('Group updated')).toBeVisible()

		// The unique index compares names without case (deviation 2).
		await page.getByRole('button', { name: 'Add group' }).click()
		await page.getByLabel('Name').fill(`${groupName()} RENAMED`.toLowerCase())
		await page.getByRole('button', { name: 'Add', exact: true }).click()
		await expect(page.getByText('A group with this name already exists')).toBeVisible()
		await page.getByRole('button', { name: 'Cancel' }).click()

		const renamed = page.getByRole('row', { name: new RegExp(`${groupName()} renamed`) })
		await renamed.getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
		await expect(page.getByText('Group deleted')).toBeVisible()
		await expect(renamed).toHaveCount(0)
	})

	// Deviation 3 and ruling M13: a pick deleted meanwhile is the picker's own error, cleared when the pick changes.
	test('an account deleted after the page loaded is refused on the picker, and the error clears on a new pick', async ({
		page,
	}) => {
		await seedUser({ email: `${tag()}-gone@e2e.local`, password: PASSWORD, name: 'Gone member' })
		await openGroups(page)
		await page.getByRole('button', { name: 'Add group' }).click()
		await page.getByLabel('Name').fill(groupName())
		await pickMember(page, `Gone member (${tag()}-gone@e2e.local)`, `${tag()}-gone`)
		await withDb(db => db.execute('DELETE FROM users WHERE email = ?', [`${tag()}-gone@e2e.local`]))
		await page.getByRole('button', { name: 'Add', exact: true }).click()
		const error = page.getByText(
			'A picked account no longer exists. Reload the page and pick again.',
		)
		await expect(error).toBeVisible()
		await pickMember(page, `Group member (${email()})`, email())
		await expect(error).toHaveCount(0)
	})

	// Spec §3.1: deleting a group removes its grants (ON DELETE CASCADE), so its members lose the app.
	test('deleting a group takes away the apps granted through it', async ({ page, browser }) => {
		const appId = await seedApp({ name: `Through group ${tag()}`, accessMode: 'restricted' })
		const member = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			await openGroups(page)
			await page.getByRole('button', { name: 'Add group' }).click()
			await page.getByLabel('Name').fill(groupName())
			await pickMember(page, `Group member (${email()})`, email())
			await page.getByRole('button', { name: 'Add', exact: true }).click()
			await expect(page.getByText('Group added')).toBeVisible()
			// The group the form created, read back from MySQL (the pattern of e2e/admin-users.spec.ts).
			const [found] = await withDb(db =>
				db.execute<RowDataPacket[]>('SELECT id FROM user_groups WHERE name = ?', [groupName()]),
			)
			expect(found).toHaveLength(1)
			await grantAppToGroup(appId, found[0]!.id as string)

			const memberPage = await member.newPage()
			await signInAs(memberPage, email(), PASSWORD)
			await expect(memberPage.getByText(`Through group ${tag()}`, { exact: true })).toBeVisible()

			const row = page.getByRole('row', { name: new RegExp(groupName()) })
			await row.getByRole('button', { name: 'Delete' }).click()
			await page.getByRole('button', { name: 'Delete', exact: true }).last().click()
			await expect(page.getByText('Group deleted')).toBeVisible()

			await memberPage.reload()
			await expect(memberPage.getByText(`Through group ${tag()}`, { exact: true })).toHaveCount(0)
		} finally {
			await member.close()
			await deleteApp(appId)
		}
	})
})

test('the admin navigation reaches the groups page', async ({ page, isMobile }) => {
	await page.goto('/app-management')
	if (isMobile) {
		// The sidebar is hidden below md; the header's drawer takes its place. This page has no hydration-only
		// signal, so the first click is retried with its outcome (Playwright, expect.toPass).
		await expect(async () => {
			await page.getByRole('button', { name: 'Menu' }).click()
			await expect(page.getByRole('menuitem', { name: 'Group management' })).toBeVisible({
				timeout: 1000,
			})
		}).toPass()
		await page.getByRole('menuitem', { name: 'Group management' }).click()
	} else {
		await page.getByRole('complementary').getByRole('link', { name: 'Group management' }).click()
	}
	await expect(page).toHaveURL(/\/group-management$/)
})
