import { expect, test } from '@playwright/test'

test('the language dropdown switches the UI and the html lang', async ({ page }) => {
	await page.goto('/app-management')
	await page.getByRole('button', { name: 'Language' }).click()
	await page.getByRole('menuitem', { name: 'العربية' }).click()
	await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
	await page.getByRole('button', { name: /اللغة/ }).click()
	await page.getByRole('menuitem', { name: 'English' }).click()
	await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})

test('the theme dropdown switches to dark and the shell surface follows', async ({
	page,
}, testInfo) => {
	test.skip(testInfo.project.use.colorScheme === 'dark', 'starts dark already')
	const shellBackground = () =>
		page
			.locator('.ant-layout')
			.first()
			.evaluate(el => getComputedStyle(el).backgroundColor)
	await page.goto('/app-management')
	// The starting surface is not black, so the final assertion proves a switch rather than a state.
	await expect.poll(shellBackground).not.toBe('rgb(0, 0, 0)')
	await page.getByRole('button', { name: 'Theme' }).click()
	await page.getByRole('menuitem', { name: 'Dark' }).click()
	await expect.poll(shellBackground).toBe('rgb(0, 0, 0)')
})

test('the account dropdown shows the email and logs out', async ({ page }) => {
	await page.goto('/app-management')
	await page.getByRole('button', { name: /signed in as/i }).click()
	await expect(page.getByRole('menuitem', { name: /admin@e2e\.local/ })).toBeVisible()
	await page.getByRole('menuitem', { name: /log out/i }).click()
	await expect(page).toHaveURL(/\/login/)
})

test('on mobile the admin navigation opens from the menu button', async ({ page }, testInfo) => {
	test.skip(!testInfo.project.name.startsWith('mobile'), 'desktop shows the menu inline')
	await page.goto('/app-management')
	await page.getByRole('button', { name: 'Menu' }).click()
	await page.getByRole('menuitem', { name: 'User management' }).click()
	await expect(page).toHaveURL(/\/user-management$/)
})
