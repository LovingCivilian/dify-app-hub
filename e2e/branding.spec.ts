import { expect, test } from '@playwright/test'

// Settings spec §4.6: with nothing saved the hub shows its built-in brand; the header has no GitHub button.
test.describe('the built-in brand', () => {
	test('the header and the tab show it, and the GitHub button is gone', async ({ page }) => {
		await page.goto('/apps')
		await expect(page).toHaveTitle('Dify App Hub')
		await expect(page.getByRole('banner').getByRole('link', { name: 'Dify App Hub' })).toBeVisible()
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
			'href',
			/\/_next\/static\/media\/logo/,
		)
		await expect(page.getByRole('button', { name: 'GitHub' })).toHaveCount(0)
		await expect(page.getByRole('link', { name: 'GitHub' })).toHaveCount(0)
	})

	test('the login page shows the name under the logo', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		const page = await context.newPage()
		await page.goto('/login')
		await expect(page.getByRole('heading', { name: 'Dify App Hub' })).toBeVisible()
		await context.close()
	})
})
