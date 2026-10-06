import { expect, type Page, test } from '@playwright/test'

import { withDb } from './fixtures/db'
import { drawerOpened } from './fixtures/drawer'
import { e2eEnv } from './fixtures/env'

const row = (page: Page, email: string) => page.getByRole('row', { name: new RegExp(email) })

test.describe('user CRUD', () => {
	// Spec users carry the project name and are removed after each test (the database survives between runs).
	test.afterEach(async ({}, testInfo) => {
		await withDb(db =>
			db.execute('DELETE FROM users WHERE email LIKE ?', [`user-${testInfo.project.name}%`]),
		)
	})

	test('an admin adds a user (8-character minimum), edits it, cannot reuse its email, and deletes it', async ({
		page,
	}, testInfo) => {
		const email = `user-${testInfo.project.name}@e2e.local`
		await page.goto('/user-management')

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

		await row(page, email).getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog').filter({ hasText: 'Edit user' })
		await edit.getByLabel('New password').fill('1234567')
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(edit.getByText('Password must be at least 8 characters')).toBeVisible()
		await edit.getByLabel('New password').fill('')
		await edit.getByLabel('Name').fill('Spec user renamed')
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(row(page, email)).toContainText('Spec user renamed')
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
		await page.request.post('/api/users', { data: { name: 'Needle', email, password: '12345678' } })
		await page.goto('/user-management')
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
