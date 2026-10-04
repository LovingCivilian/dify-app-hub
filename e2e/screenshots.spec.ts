import { test, type Page } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

const signedInPages = {
	apps: '/apps',
	admin: '/app-management',
	users: '/user-management',
	chat: `/chat/${APP_ID}`,
}

async function capture(page: Page, name: string, path: string, project: string) {
	await page.goto(path)
	await page.waitForLoadState('networkidle')
	await page.screenshot({ path: `e2e/screenshots/${name}-${project}.png`, fullPage: true })
}

// A signed-in visitor is redirected away from /login, so the login page is shot signed out
// (documented reset: https://playwright.dev/docs/auth).
test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('screenshot login', async ({ page }, testInfo) => {
		await capture(page, 'login', '/login', testInfo.project.name)
	})
})

for (const [name, path] of Object.entries(signedInPages)) {
	test(`screenshot ${name}`, async ({ page }, testInfo) => {
		await capture(page, name, path, testInfo.project.name)
	})
}
