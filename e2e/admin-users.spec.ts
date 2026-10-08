import { expect, type Page, test } from '@playwright/test'

import { withDb } from './fixtures/db'
import { drawerOpened } from './fixtures/drawer'
import { e2eEnv } from './fixtures/env'
import { seedUser, signInAs } from './fixtures/users'

const row = (page: Page, email: string) => page.getByRole('row', { name: new RegExp(email) })

/**
 * Opens the users page and waits until its table has hydrated. The page is server-rendered, and a click that lands
 * before React has attached its handlers does nothing (Playwright docs, "Navigations > Hydration"); seen on the
 * mobile project, where Edit opened no drawer. ClientDateTime shows a date only after it has mounted, so a date in
 * the table marks a hydrated table (the time-zone test below reads the same state).
 */
const openUsers = async (page: Page) => {
	await page.goto('/user-management')
	await expect(page.getByRole('table').locator('time').first()).not.toContainText(/^\s*$/)
}

test.describe('user CRUD', () => {
	// Spec users carry the project name and are removed after each test (the database survives between runs).
	test.afterEach(async () => {
		const { project } = test.info()
		await withDb(db =>
			db.execute('DELETE FROM users WHERE email LIKE ?', [`user-${project.name}%`]),
		)
	})

	test('an admin adds a user (8-character minimum), edits it, cannot reuse its email, and deletes it', async ({
		page,
	}, testInfo) => {
		const email = `user-${testInfo.project.name}@e2e.local`
		await openUsers(page)

		await page.getByRole('button', { name: 'Add user' }).click()
		const add = page.getByRole('dialog').filter({ hasText: 'Add user' })
		await add.getByLabel('Name').fill('Spec user')
		await add.getByLabel('Email').fill(email)
		await add.getByLabel('Password').fill('1234567')
		await add.getByRole('button', { name: 'Add' }).click()
		await expect(add.getByText('Password must be at least 8 characters')).toBeVisible()
		await add.getByLabel('Password').fill('12345678')
		await add.getByRole('button', { name: 'Add' }).click()
		await expect(row(page, email)).toBeVisible()
		// Case-sensitive: only the role tag reads "User" (the name is "Spec user", the email lowercase).
		await expect(row(page, email)).toContainText('User')

		await row(page, email).getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog').filter({ hasText: 'Edit user' })
		await edit.getByLabel('New password').fill('1234567')
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(edit.getByText('Password must be at least 8 characters')).toBeVisible()
		await edit.getByLabel('New password').fill('')
		await edit.getByLabel('Name').fill('Spec user renamed')
		// antd draws a button-style radio's <input> at 0×0 with pointer-events: none, so the visible label is clicked.
		await edit.getByText('Admin', { exact: true }).click()
		await expect(edit.getByRole('radio', { name: 'Admin' })).toBeChecked()
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(row(page, email)).toContainText('Spec user renamed')
		await expect(row(page, email)).toContainText('Admin')
		await expect(edit).toBeHidden()

		// The drawer keeps its title and fields while it slides out (the user is cleared in afterOpenChange).
		await row(page, email).getByRole('button', { name: 'Edit' }).click()
		await expect(edit.getByLabel('Name')).toHaveValue('Spec user renamed')
		await drawerOpened(edit)
		await edit.getByRole('button', { name: 'Cancel' }).click()
		await expect(edit).toContainText('Edit user')
		await expect(edit.getByLabel('New password')).toBeVisible()
		await expect(edit).toBeHidden()

		await page.getByRole('button', { name: 'Add user' }).click()
		const again = page.getByRole('dialog').filter({ hasText: 'Add user' })
		// A new user starts from empty fields, whoever was edited before.
		await expect(again.getByLabel('Name')).toHaveValue('')
		await expect(again.getByLabel('Email')).toHaveValue('')
		await again.getByLabel('Name').fill('Twin')
		await again.getByLabel('Email').fill(email)
		await again.getByLabel('Password').fill('12345678')
		await again.getByRole('button', { name: 'Add' }).click()
		await expect(page.getByText('This email is already in use')).toBeVisible()
		await again.getByRole('button', { name: 'Cancel' }).click()

		await row(page, email).getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete' }).last().click()
		await expect(row(page, email)).toHaveCount(0)
	})

	test('search narrows the table, and the signed-in admin has no Delete', async ({
		page,
	}, testInfo) => {
		const email = `user-${testInfo.project.name}-search@e2e.local`
		await seedUser({ email, password: '12345678', name: 'Needle' })
		await openUsers(page)
		await expect(row(page, email)).toBeVisible()
		await page.getByRole('textbox', { name: 'Search users' }).fill('needle')
		await expect(row(page, email)).toBeVisible()
		await expect(row(page, e2eEnv.E2E_ADMIN_EMAIL)).toHaveCount(0)
		await page.getByRole('textbox', { name: 'Search users' }).fill('no such user')
		await expect(page.getByText('No users match your search')).toBeVisible()
		await page.getByRole('textbox', { name: 'Search users' }).fill('')
		const own = row(page, e2eEnv.E2E_ADMIN_EMAIL)
		await expect(own.getByRole('button', { name: 'Edit' })).toBeVisible()
		await expect(own.getByRole('button', { name: 'Delete' })).toHaveCount(0)
	})

	test('editing a user onto an email another account holds says it is in use and writes nothing', async ({
		page,
	}, testInfo) => {
		// updateUser's email check runs only against MySQL, so the e2e suite is where it is exercised.
		const email = `user-${testInfo.project.name}-moved@e2e.local`
		const taken = `user-${testInfo.project.name}-taken@e2e.local`
		await seedUser({ email, password: '12345678', name: 'Moved' })
		await seedUser({ email: taken, password: '12345678', name: 'Taken' })
		await openUsers(page)
		await row(page, email).getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog').filter({ hasText: 'Edit user' })
		await edit.getByLabel('Email').fill(taken)
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(page.getByText('This email is already in use')).toBeVisible()
		await edit.getByRole('button', { name: 'Cancel' }).click()
		await expect(edit).toBeHidden()
		await page.reload()
		await expect(row(page, email)).toBeVisible()
		await expect(row(page, taken)).toBeVisible()
	})

	test('the own row of the owner offers no password field and a fixed role, and still saves', async ({
		page,
	}) => {
		await openUsers(page)
		const own = row(page, e2eEnv.E2E_ADMIN_EMAIL)
		await expect(own).toContainText('Owner')
		await own.getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog').filter({ hasText: 'Edit user' })
		await expect(edit.getByText('Change your own password from the account menu.')).toBeVisible()
		await expect(edit.getByLabel('New password')).toHaveCount(0)
		await expect(edit.getByText('You cannot change your own role.')).toBeVisible()
		await expect(edit.getByRole('radio', { name: 'Owner' })).toBeChecked()
		await expect(edit.getByRole('radio', { name: 'Owner' })).toBeDisabled()
		// The disabled role is still submitted (the action's schema requires it): saving the unchanged row succeeds.
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(page.getByText('User updated')).toBeVisible()
		await expect(own).toContainText('Owner')
	})

	test('the owner demotes a signed-in admin, whose next page lands on /apps', async ({
		page,
		browser,
	}, testInfo) => {
		// Not ending in admin@e2e.local: the row locator is a substring match, and the owner's email is admin@e2e.local.
		const email = `user-${testInfo.project.name}-second@e2e.local`
		await seedUser({ email, password: 'second-admin-1', name: 'Second admin', role: 'admin' })
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const second = await context.newPage()
			await signInAs(second, email, 'second-admin-1')
			await second.goto('/user-management')
			await expect(second).toHaveURL(/\/user-management$/)

			await openUsers(page)
			await row(page, email).getByRole('button', { name: 'Edit' }).click()
			const edit = page.getByRole('dialog').filter({ hasText: 'Edit user' })
			await edit.getByText('User', { exact: true }).click()
			await expect(edit.getByRole('radio', { name: 'User' })).toBeChecked()
			await edit.getByRole('button', { name: 'Update' }).click()
			await expect(row(page, email)).toContainText('User')

			// The jwt callback refreshes the role from the row (decision a): the demoted session keeps working as a user.
			await second.goto('/user-management')
			await expect(second).toHaveURL(/\/apps$/)
		} finally {
			await context.close()
		}
	})

	test('an admin manages users only: no Edit or Delete on the owner or another admin, only the User role', async ({
		browser,
	}, testInfo) => {
		const prefix = `user-${testInfo.project.name}-rank`
		const adminEmail = `${prefix}-a@e2e.local`
		const peerEmail = `${prefix}-peer@e2e.local`
		const createdEmail = `${prefix}-created@e2e.local`
		await seedUser({
			email: adminEmail,
			password: 'rank-admin-1',
			name: 'Rank admin',
			role: 'admin',
		})
		await seedUser({ email: peerEmail, password: 'rank-peer-1', name: 'Rank peer', role: 'admin' })
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const page = await context.newPage()
			await signInAs(page, adminEmail, 'rank-admin-1')
			await openUsers(page)
			for (const email of [e2eEnv.E2E_ADMIN_EMAIL, peerEmail]) {
				await expect(row(page, email)).toBeVisible()
				await expect(row(page, email).getByRole('button', { name: 'Edit' })).toHaveCount(0)
				await expect(row(page, email).getByRole('button', { name: 'Delete' })).toHaveCount(0)
			}

			await page.getByRole('button', { name: 'Add user' }).click()
			const add = page.getByRole('dialog').filter({ hasText: 'Add user' })
			await expect(add.getByRole('radio')).toHaveCount(1)
			await expect(add.getByRole('radio', { name: 'User' })).toBeChecked()
			await expect(add.getByRole('radio', { name: 'User' })).toBeDisabled()
			await expect(add.getByText('Only the owner can give the admin role.')).toBeVisible()
			await add.getByLabel('Name').fill('Rank created')
			await add.getByLabel('Email').fill(createdEmail)
			await add.getByLabel('Password').fill('12345678')
			await add.getByRole('button', { name: 'Add' }).click()
			await expect(row(page, createdEmail)).toContainText('User')

			await row(page, createdEmail).getByRole('button', { name: 'Delete' }).click()
			await page.getByRole('button', { name: 'Delete' }).last().click()
			await expect(row(page, createdEmail)).toHaveCount(0)
		} finally {
			await context.close()
		}
	})
})

test.describe('dates in the browser zone', () => {
	// Far from the server's UTC (Review Focus 4): the text must be the browser's, with no hydration complaint.
	test.use({ timezoneId: 'Pacific/Kiritimati' })

	test('user dates render in the browser time zone without a hydration mismatch', async ({
		page,
	}) => {
		const complaints: string[] = []
		page.on('console', message => {
			if (/hydrat/i.test(message.text())) complaints.push(message.text())
		})
		await page.goto('/user-management')
		const time = page
			.getByRole('row', { name: /admin@e2e\.local/ })
			.locator('time')
			.first()
		await expect(time).not.toContainText(/^\s*$/)
		const { text, local, utc } = await time.evaluate(el => {
			const at = new Date(el.getAttribute('datetime') ?? '')
			return {
				text: el.textContent,
				local: at.toLocaleString('en-US'),
				utc: at.toLocaleString('en-US', { timeZone: 'UTC' }),
			}
		})
		expect(text).toBe(local)
		expect(text).not.toBe(utc)
		expect(complaints).toEqual([])
	})
})
