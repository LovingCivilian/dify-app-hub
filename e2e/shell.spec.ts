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

test('the chosen language is kept in the i18next cookie, so the server renders it after a reload', async ({
	page,
}) => {
	await page.goto('/app-management')
	await page.getByRole('button', { name: 'Language' }).click()
	await page.getByRole('menuitem', { name: 'العربية' }).click()
	await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
	// The language detector caches the language in its cookie on every changeLanguage (`caches`).
	await expect.poll(() => page.evaluate(() => document.cookie)).toMatch(/(?:^|; )i18next=ar(?:;|$)/)
	// The server reads the same cookie: the next HTML is already Arabic.
	const html = await (await page.request.get('/app-management')).text()
	expect(html).toMatch(/<html[^>]*\blang="ar"/)
	await page.reload()
	await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
	await expect(page.getByRole('button', { name: 'اللغة' })).toBeVisible()
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
	// Chrome serialises the computed value with the keyword after the scheme: "light only".
	await expect(page.locator('html')).toHaveCSS('color-scheme', 'light only')
	await page.getByRole('button', { name: 'Theme' }).click()
	await page.getByRole('menuitem', { name: 'Dark' }).click()
	await expect.poll(shellBackground).toBe('rgb(0, 0, 0)')
	// The browser's scheme follows the antd algorithm (ADR-0021): the html style flips with the toggle.
	await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
})

test('the account dropdown shows the email and logs out', async ({ page }) => {
	await page.goto('/app-management')
	await page.getByRole('button', { name: /signed in as/i }).click()
	await expect(page.getByRole('menuitem', { name: /admin@e2e\.local/ })).toBeVisible()
	// Sign-out is a full page load (next-auth's default redirect), so no client state of the signed-out user
	// survives (ADR-0017 note of 2026-10-05): a value left on window before the click is gone afterwards.
	await page.evaluate(() => Object.assign(window, { beforeLogout: true }))
	await page.getByRole('menuitem', { name: /log out/i }).click()
	await expect(page).toHaveURL(/\/login/)
	await expect.poll(() => page.evaluate(() => 'beforeLogout' in window)).toBe(false)
})

test('on mobile the admin navigation opens from the menu button', async ({ page }, testInfo) => {
	test.skip(!testInfo.project.name.startsWith('mobile'), 'desktop shows the menu inline')
	await page.goto('/app-management')
	await page.getByRole('button', { name: 'Menu' }).click()
	await page.getByRole('menuitem', { name: 'User management' }).click()
	await expect(page).toHaveURL(/\/user-management$/)
})
