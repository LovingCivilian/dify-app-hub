import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'
import { stubApiBase } from './fixtures/env'

// A fresh stub per test: the chat then opens a new conversation instead of reopening a stored one and
// loading its history, which races with a message sent at once (a chat bug left to sub-project 2).
test.beforeEach(async ({ request }) => {
	const response = await request.post(`${stubApiBase}/__e2e/reset`)
	await expect(response).toBeOK()
})

test('a signed-out visitor is sent to the login page with a callback', async ({ browser }) => {
	const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
	const page = await context.newPage()
	await page.goto('/app-management')
	await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fapp-management$/)
	await context.close()
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
	await test.step('the header navigation offers the user management page', async step => {
		// Below md the horizontal Menu is not rendered and the Drawer menu mounts only once opened;
		// the mobile Drawer navigation is pinned by its own flow.
		step.skip(isMobile, 'the horizontal navigation is not part of the mobile layout')
		const nav = page.locator('header.ant-layout-header').getByRole('menu')
		await expect(nav.getByRole('menuitem', { name: 'User management' })).toBeVisible()
	})
	await expect(page.locator('.ant-table')).toBeVisible()
})
