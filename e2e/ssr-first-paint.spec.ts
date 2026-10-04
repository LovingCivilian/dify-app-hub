import { expect, test } from '@playwright/test'

import { baseURL } from './fixtures/env'

/**
 * The server HTML is read with the API request context (shares the page's cookies, Playwright docs:
 * "page.request"), so these assertions see exactly what the browser gets before hydration.
 */
test('the first HTML carries the dark scheme when the theme cookies say so', async ({ page }) => {
	await page.context().addCookies([
		{ name: 'theme-mode', value: 'dark', url: baseURL },
		{ name: 'theme', value: 'dark', url: baseURL },
	])
	const response = await page.request.get('/apps')
	expect(response.ok()).toBe(true)
	const html = await response.text()
	expect(html).toContain('class="antialiased dark"')
	// AntdRegistry inlines antd's <style id="antd-cssinjs"> in the server HTML (also under next dev, measured
	// 2026-10-04), so the dark algorithm is already in the first HTML, not applied after hydration. The production
	// build gets the same check as a curl in Task 20.
	expect(html).toContain('--ant-color-bg-layout:#000000')
	// And the browser agrees once hydrated (#000000 is the dark token, see providers.spec.ts).
	await page.goto('/apps')
	await expect(page.locator('.ant-app').first()).toHaveCSS('--ant-color-bg-layout', '#000000')
})

test('junk theme cookies still render the light default', async ({ page }) => {
	// Both cookies are set: the signed-in storage state already carries theme-mode=system and theme=light.
	await page.context().addCookies([
		{ name: 'theme-mode', value: 'purple', url: baseURL },
		{ name: 'theme', value: 'neon', url: baseURL },
	])
	const response = await page.request.get('/apps')
	expect(response.ok()).toBe(true)
	const html = await response.text()
	expect(html).toContain('class="antialiased"')
	expect(html).not.toContain('class="antialiased dark"')
	expect(html).toContain('--ant-color-bg-layout:#f5f5f5')
})

// The migration needs a visitor without theme cookies, so the signed-in storage state is replaced by an empty one
// (documented reset: https://playwright.dev/docs/auth) and the signed-out login page is used.
test.describe('legacy localStorage theme entries', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('are migrated into the cookies once and then removed', async ({ page }) => {
		const themeModeCookie = async () =>
			(await page.context().cookies()).find(cookie => cookie.name === 'theme-mode')?.value
		// The old entries exist before the app runs; sessionStorage keeps the reload below from seeding them again.
		await page.addInitScript(() => {
			if (sessionStorage.getItem('legacy-seeded')) return
			sessionStorage.setItem('legacy-seeded', '1')
			localStorage.setItem('__DC__THEME_MODE', 'dark')
			localStorage.setItem('__DC__THEME', 'dark')
		})
		await page.goto('/login')
		await expect(page.locator('body')).toHaveClass(/\bdark\b/)
		await expect.poll(themeModeCookie).toBe('dark')
		await expect
			.poll(() =>
				page.evaluate(() => [
					localStorage.getItem('__DC__THEME_MODE'),
					localStorage.getItem('__DC__THEME'),
				]),
			)
			.toEqual([null, null])

		// An expired cookie must not bring the old value back: the next visit starts from the system default.
		await page.context().clearCookies({ name: /^theme/ })
		await page.reload()
		await expect.poll(themeModeCookie).toBe('system')
	})
})
