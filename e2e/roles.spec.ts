import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'user-pass-1'
/** The spec's account carries the project name (rows survive between runs). */
const emailOf = () => `role-${test.info().project.name}@e2e.local`

test.describe('a user-role account (charter §4.6)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test.beforeEach(async () => {
		await seedUser({ email: emailOf(), password: PASSWORD, name: 'Plain user' })
	})
	test.afterEach(async () => {
		await deleteUsersLike(`role-${test.info().project.name}%`)
	})

	test('is sent from the admin pages to /apps and still reaches a chat', async ({ page }) => {
		await signInAs(page, emailOf(), PASSWORD)
		for (const path of ['/app-management', '/user-management']) {
			await page.goto(path)
			await expect(page).toHaveURL(/\/apps$/)
		}
		await page.goto(`/chat/${APP_ID}`)
		await expect(page.getByPlaceholder('Type a message')).toBeVisible()
	})
})

// ADR-0024: an admin who is not the owner has the admin surface too. Its own prefix keeps the user-role
// describe's cleanup (`role-<project>%`) from deleting this account.
test.describe('an admin account that is not the owner', () => {
	test.use({ storageState: { cookies: [], origins: [] } })
	const adminEmailOf = () => `roleadmin-${test.info().project.name}@e2e.local`

	test.beforeEach(async () => {
		await seedUser({
			email: adminEmailOf(),
			password: PASSWORD,
			name: 'Plain admin',
			role: 'admin',
		})
	})
	test.afterEach(async () => {
		await deleteUsersLike(`roleadmin-${test.info().project.name}%`)
	})

	test('reaches the admin pages', async ({ page }) => {
		await signInAs(page, adminEmailOf(), PASSWORD)
		for (const path of ['/app-management', '/user-management']) {
			await page.goto(path)
			await expect(page).toHaveURL(new RegExp(`${path}$`))
		}
	})
})

// Part 1 spec §9, Docker gate: the annotation routes are gone, so a signed-in caller meets Next's 404 there.
test('the annotation routes answer 404', async ({ page }) => {
	for (const path of [
		`/api/dify/${APP_ID}/apps/annotations`,
		`/api/dify/${APP_ID}/apps/annotations/3b241101-e2bb-4255-8caf-4136c566a962`,
	])
		expect((await page.request.get(path)).status()).toBe(404)
})
