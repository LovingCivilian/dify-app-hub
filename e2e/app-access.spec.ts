import { expect, test } from '@playwright/test'

import {
	appsOpenToEveryone,
	deleteAppsLike,
	deleteGroupsLike,
	grantAppToGroup,
	grantAppToUser,
	seedApp,
	seedGroup,
	setAccessMode,
} from './fixtures/access'
import { ADMIN_STATE } from './fixtures/constants'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const PASSWORD = 'access-pass-1'
const tag = () => `access-${test.info().project.name}`
const appName = () => `Restricted ${tag()}`
/**
 * Every app this spec seeds ends with the project's tag, so the clean-up deletes by name and needs no id: it also runs
 * when a `beforeEach` failed before seeding (mysql2 refuses an `undefined` bind parameter), and it clears what a
 * killed run left behind.
 */
const deleteOwnApps = () => deleteAppsLike(`%${tag()}`)
const notFound = { code: 'app_not_found', message: 'No such app.', status: 404 }

// Review Focus 1: an app the account was not granted is answered as a missing one everywhere.
test.describe('per-app access for a user-role account (B3 spec §4)', () => {
	test.use({ storageState: { cookies: [], origins: [] } })
	let appId: string
	let userId: string

	test.beforeEach(async () => {
		await deleteOwnApps()
		userId = await seedUser({
			email: `${tag()}@e2e.local`,
			password: PASSWORD,
			name: 'Access user',
		})
		appId = await seedApp({ name: appName(), accessMode: 'restricted' })
	})
	test.afterEach(async () => {
		await deleteOwnApps()
		await deleteGroupsLike(`%${tag()}`)
		await deleteUsersLike(`${tag()}%`)
	})

	test('cannot see or open an app nobody granted', async ({ page }) => {
		await signInAs(page, `${tag()}@e2e.local`, PASSWORD)
		await expect(page.getByText('Stub app', { exact: true })).toBeVisible()
		await expect(page.getByText(appName(), { exact: true })).toHaveCount(0)
		await page.goto(`/chat/${appId}`)
		await expect(
			page.getByText('No Dify app configuration found. Contact your administrator.'),
		).toBeVisible()
		const parameters = await page.request.get(`/api/dify/${appId}/parameters`)
		expect(parameters.status()).toBe(404)
		expect(await parameters.json()).toEqual(notFound)
		expect((await page.request.get(`/api/apps/${appId}/icon`)).status()).toBe(404)
	})

	test('sees and opens an app granted to the account', async ({ page }) => {
		await grantAppToUser(appId, userId)
		await signInAs(page, `${tag()}@e2e.local`, PASSWORD)
		await expect(page.getByText(appName(), { exact: true })).toBeVisible()
		await page.goto(`/chat/${appId}`)
		await expect(page.getByPlaceholder('Type a message')).toBeVisible()
		expect((await page.request.get(`/api/dify/${appId}/parameters`)).status()).toBe(200)
		const icon = await page.request.get(`/api/apps/${appId}/icon`)
		expect(icon.status()).toBe(200)
		expect(icon.headers()['content-type']).toBe('image/png')
	})

	test('sees an app granted to one of its groups', async ({ page }) => {
		const groupId = await seedGroup({ name: `Group ${tag()}`, memberIds: [userId] })
		await grantAppToGroup(appId, groupId)
		await signInAs(page, `${tag()}@e2e.local`, PASSWORD)
		await expect(page.getByText(appName(), { exact: true })).toBeVisible()
	})

	// Spec §8. The stub apps are open to everyone and shared by every spec, so this case closes them for its own run
	// and reopens exactly those in `finally` (the suite runs one worker; e2e/auth.setup.ts reopens the stub apps if
	// a run is killed in between).
	test('sees the empty gallery when no app is open or granted to it', async ({ page }) => {
		const open = await appsOpenToEveryone()
		try {
			await setAccessMode(open, 'restricted')
			await signInAs(page, `${tag()}@e2e.local`, PASSWORD)
			await expect(
				page.getByText('No apps are available to you yet. Ask your administrator.'),
			).toBeVisible()
			await expect(page.getByText('Stub app', { exact: true })).toHaveCount(0)
		} finally {
			await setAccessMode(open, 'everyone')
		}
	})
})

test.describe('the owner', () => {
	test.use({ storageState: ADMIN_STATE })
	let appId: string

	test.beforeEach(async () => {
		await deleteOwnApps()
		appId = await seedApp({ name: `Admins only ${tag()}`, accessMode: 'restricted' })
	})
	test.afterEach(async () => {
		await deleteOwnApps()
	})

	test('sees and opens a restricted app nobody was granted', async ({ page }) => {
		await page.goto('/apps')
		await expect(page.getByText(`Admins only ${tag()}`, { exact: true })).toBeVisible()
		await page.goto(`/chat/${appId}`)
		await expect(page.getByPlaceholder('Type a message')).toBeVisible()
	})
})
