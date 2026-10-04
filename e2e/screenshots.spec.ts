import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

/**
 * Readiness is asserted with web-first assertions: Playwright discourages `networkidle`
 * ("rely on web assertions to assess readiness instead",
 * https://playwright.dev/docs/api/class-page#page-goto, `waitUntil`).
 * The `(user)` layout renders a fullscreen Spin until the session is known and the admin tables
 * show their own Spin while they fetch, so every page first waits for no antd Spin to be active,
 * then for the header and for seeded data that only the finished page shows.
 */
async function noSpinner(page: Page) {
	await expect(page.locator('.ant-spin-fullscreen')).toHaveCount(0)
	await expect(page.locator('.ant-spin-spinning')).toHaveCount(0)
}

const header = (page: Page) => page.locator('header.ant-layout-header')
const stubApp = (page: Page) => page.getByText('Stub app').first()

const signedInPages: Record<string, { path: string; ready: (page: Page) => Promise<void> }> = {
	apps: {
		path: '/apps',
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(stubApp(page)).toBeVisible()
		},
	},
	admin: {
		path: '/app-management',
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(stubApp(page)).toBeVisible()
		},
	},
	users: {
		path: '/user-management',
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(page.getByText('admin@e2e.local').first()).toBeVisible()
		},
	},
	chat: {
		path: `/chat/${APP_ID}`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(page.getByText('Hello from the stub')).toBeVisible()
			await expect(page.getByRole('textbox').first()).toBeVisible()
		},
	},
}

/**
 * The server renders the light theme and the client applies the preferred scheme after hydration
 * (the `dark` class on `<body>`), so dark projects wait for that class; `animations: 'disabled'`
 * then fast-forwards the antd colour transitions that hydration starts
 * (https://playwright.dev/docs/api/class-page#page-screenshot, option `animations`).
 */
async function capture(page: Page, name: string, testInfo: TestInfo) {
	if (testInfo.project.use.colorScheme === 'dark') {
		await expect(page.locator('body')).toHaveClass(/\bdark\b/)
	}
	await page.screenshot({
		path: `e2e/screenshots/${name}-${testInfo.project.name}.png`,
		fullPage: true,
		animations: 'disabled',
	})
}

// A signed-in visitor is redirected away from /login, so the login page is shot signed out
// (documented reset: https://playwright.dev/docs/auth).
test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('screenshot login', async ({ page }, testInfo) => {
		await page.goto('/login')
		await noSpinner(page)
		await expect(page.locator('.ant-card')).toBeVisible()
		await capture(page, 'login', testInfo)
	})
})

for (const [name, { path, ready }] of Object.entries(signedInPages)) {
	test(`screenshot ${name}`, async ({ page }, testInfo) => {
		await page.goto(path)
		await ready(page)
		await capture(page, name, testInfo)
	})
}
