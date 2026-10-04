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

test('the shell and the account button are in the server HTML for a signed-in visitor', async ({
	page,
}) => {
	const html = await (await page.request.get('/app-management')).text()
	expect(html).toContain('class="ant-layout-header')
	expect(html).toContain('aria-label="Signed in as admin@e2e.local"')
})

test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('a signed-out request for a user page is redirected by the proxy with a callback', async ({
		page,
	}) => {
		const response = await page.request.get('/apps', { maxRedirects: 0 })
		expect(response.status()).toBe(307)
		expect(response.headers()['location']).toMatch(/\/login\?callbackUrl=%2Fapps$/)
	})
})

test('the server HTML holds both breakpoint variants of the header, so no branch is chosen before hydration', async ({
	page,
}) => {
	const html = await (await page.request.get('/app-management')).text()
	// Desktop navigation (horizontal Menu) and the mobile trigger (named through system.menu) both exist;
	// CSS media queries at antd's screen tokens decide which one shows (spec §3.3).
	expect(html).toContain('ant-menu-horizontal')
	expect(html).toContain('aria-label="Menu"')
})

test('the media query shows one header variant and display: none keeps the other out of reach', async ({
	page,
	isMobile,
}) => {
	await page.goto('/app-management')
	const header = page.locator('header.ant-layout-header')
	const trigger = header.locator('button[aria-label="Menu"]')
	const nav = header.locator('.ant-menu-horizontal')
	// Both variants are in the DOM at the same time, whatever the viewport; the media query at antd's screenMD (768)
	// decides which one is displayed. The menu is checked first: a header that picks its branch with a hook only
	// has the trigger in the server HTML and swaps in the menu after hydration, so it cannot satisfy both counts.
	await expect(nav).toHaveCount(1)
	await expect(trigger).toHaveCount(1)
	await expect(trigger).toBeVisible({ visible: isMobile })
	await expect(nav).toBeVisible({ visible: !isMobile })
	// Role queries skip what display: none hides (as do screen readers), so the Menu button and the menu
	// are each reachable in exactly one viewport class: no duplicate accessible names.
	await expect(header.getByRole('button', { name: 'Menu' })).toHaveCount(isMobile ? 1 : 0)
	await expect(header.getByRole('menu')).toHaveCount(isMobile ? 0 : 1)
})
