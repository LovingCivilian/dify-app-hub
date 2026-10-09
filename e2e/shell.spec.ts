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

// Task 4b: from md up the admin navigation is the hub's sidebar (components/shell/app-sider.tsx, the chat's too),
// collapsed and expanded by antd's trigger bar at its bottom; below md the header's drawer replaces it.
test('on desktop the admin navigation is a sidebar that collapses to its icons and expands again', async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, 'no sidebar below md; the drawer flow is the next test')
	await page.goto('/user-management')
	// A click before hydration does nothing (Playwright docs, "Navigations > Hydration"): ClientDateTime fills its
	// <time> only after its effect runs, so a date in the table marks a hydrated page (as openUsers in admin-users.spec.ts).
	await expect(page.getByRole('table').locator('time').first()).not.toContainText(/^\s*$/)
	const sider = page.getByRole('complementary')
	const item = (name: string) => sider.getByRole('menuitem', { name })
	// The links are the page's one navigation landmark, a <nav> in the sider's <aside> (WHATWG HTML, "The aside
	// element": "groups of nav elements"); being the only one, it needs no label (WAI-ARIA APG, "Landmark Regions").
	const navigation = sider.getByRole('navigation')
	await expect(page.getByRole('navigation')).toHaveCount(1)
	await expect(navigation.getByRole('link', { name: 'App management' })).toBeVisible()
	await expect(navigation.getByRole('link', { name: 'User management' })).toBeVisible()
	// The current page's item is selected (Menu `selectedKeys`; antd marks it with a class, not an ARIA state).
	await expect(item('User management')).toHaveClass(/ant-menu-item-selected/)
	await expect(item('App management')).not.toHaveClass(/ant-menu-item-selected/)
	// The header has no navigation of its own from md up.
	await expect(page.locator('header.ant-layout-header').getByRole('menu')).toHaveCount(0)
	const width = async () => (await sider.boundingBox())?.width ?? 0
	const expanded = await width()
	// The trigger is a disclosure of the sider (aria-expanded, aria-controls naming the sider's id).
	const siderId = await sider.getAttribute('id')
	expect(siderId).toBeTruthy()
	const collapse = sider.getByRole('button', { name: 'Collapse sidebar' })
	await expect(collapse).toHaveAttribute('aria-expanded', 'true')
	await expect(collapse).toHaveAttribute('aria-controls', siderId!)
	await collapse.click()
	const expand = sider.getByRole('button', { name: 'Expand sidebar' })
	await expect(expand).toHaveAttribute('aria-expanded', 'false')
	await expect(expand).toHaveAttribute('aria-controls', siderId!)
	await expect.poll(width).toBeLessThan(expanded)
	// The inline Menu collapses with its Sider (icons only), and a collapsed item still navigates.
	await expect(sider.getByRole('menu')).toHaveClass(/ant-menu-inline-collapsed/)
	await item('App management').click()
	await expect(page).toHaveURL(/\/app-management$/)
	await expect(item('App management')).toHaveClass(/ant-menu-item-selected/)
	// The (admin) layout stays mounted across the client navigation, so the sider is still collapsed.
	await expect(expand).toHaveAttribute('aria-expanded', 'false')
	// The trigger is a button, so the keyboard reaches it, and Enter and Space both activate it (WAI-ARIA APG,
	// Disclosure pattern).
	await expand.focus()
	await page.keyboard.press('Enter')
	await expect(collapse).toHaveAttribute('aria-expanded', 'true')
	await expect.poll(width).toBe(expanded)
	await expect(sider.getByRole('menu')).not.toHaveClass(/ant-menu-inline-collapsed/)
	await collapse.focus()
	await page.keyboard.press('Space')
	await expect(expand).toHaveAttribute('aria-expanded', 'false')
	await expect.poll(width).toBeLessThan(expanded)
})

test('on mobile the admin navigation opens from the menu button', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'desktop shows the sidebar')
	await page.goto('/app-management')
	// The sidebar is in the page but hidden below md (CSS, spec §3.3); the header's drawer takes its place.
	await expect(page.locator('aside')).toHaveCount(1)
	await expect(page.locator('aside')).toBeHidden()
	await page.getByRole('button', { name: 'Menu' }).click()
	await page.getByRole('menuitem', { name: 'User management' }).click()
	await expect(page).toHaveURL(/\/user-management$/)
})
