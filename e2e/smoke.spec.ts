import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

// Signed out: the project's admin storage state is reset (documented reset: https://playwright.dev/docs/auth).
test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('a signed-out visitor is sent to the login page with a callback', async ({ page }) => {
		await page.goto('/app-management')
		await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fapp-management$/)
	})
})

test('the app list shows the seeded app and its chat answers from the stub', async ({
	page,
}, testInfo) => {
	// Each project sends its own text, so the reply locator can only ever match this project's message.
	const message = `hello from ${testInfo.project.name}`
	await page.goto('/apps')
	await page.getByText('Stub app').first().click()
	await expect(page).toHaveURL(new RegExp(`/chat/${APP_ID}`))
	await page.getByRole('textbox').first().fill(message)
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${message}`)).toBeVisible()
})

test('the admin area renders inside the antd shell with its navigation', async ({
	page,
	isMobile,
}) => {
	await page.goto('/app-management')
	await expect(page.locator('header.ant-layout-header')).toHaveCount(1)
	await test.step('the sidebar navigation offers the user management page', async step => {
		// Below md the sidebar is in the DOM but hidden by CSS (spec §3.3) and the header's Drawer menu
		// mounts only once opened; the mobile Drawer navigation is pinned by its own flow (shell.spec.ts).
		step.skip(isMobile, 'the sidebar is not part of the mobile layout')
		const nav = page.getByRole('complementary').getByRole('menu')
		await expect(nav.getByRole('menuitem', { name: 'User management' })).toBeVisible()
	})
	await expect(page.locator('.ant-table')).toBeVisible()
})
