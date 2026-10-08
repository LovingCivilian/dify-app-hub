import { expect, test } from '@playwright/test'

import { ADMIN_STATE, APP_ID, APP_IDS } from './fixtures/constants'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'user-pass-1'
const forbidden = { code: 'forbidden', message: 'Not allowed.', status: 403 }
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

	test('is refused by the admin-only annotation routes', async ({ page }) => {
		await signInAs(page, emailOf(), PASSWORD)
		const base = `/api/dify/${APP_ID}/apps/annotations`
		const answers = [
			await page.request.get(`${base}?page=1&limit=10`),
			await page.request.put(`${base}/ann-1`, { data: { question: 'q', answer: 'a' } }),
			await page.request.delete(`${base}/ann-1`),
			// The stub app has annotations off: a user-role account may not create one there.
			await page.request.post(base, { data: { question: 'q', answer: 'a' } }),
		]
		for (const answer of answers) {
			expect(answer.status()).toBe(403)
			expect(await answer.json()).toEqual(forbidden)
		}
	})

	test('may create an annotation where the app enables annotations', async ({ page, browser }) => {
		await signInAs(page, emailOf(), PASSWORD)
		const base = `/api/dify/${APP_IDS['advanced-chat']}/apps/annotations`
		const created = await page.request.post(base, {
			data: { question: `${emailOf()} q`, answer: 'a' },
		})
		expect(created.status()).toBe(201)
		const { id } = (await created.json()) as { id: string }
		// The stub keeps annotations in memory; the admin removes this one so other specs see the list unchanged.
		const admin = await browser.newContext({ storageState: ADMIN_STATE })
		try {
			expect((await admin.request.delete(`${base}/${id}`)).status()).toBe(204)
		} finally {
			await admin.close()
		}
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
