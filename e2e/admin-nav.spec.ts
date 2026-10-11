import { expect, test } from '@playwright/test'

// Settings spec §5.1: two groups in the sidebar, open by default; in the collapsed sidebar a group opens on click.
test('the sidebar groups the pages under Management and Settings', async ({ page, isMobile }) => {
	test.skip(isMobile, 'below md the sidebar is replaced by the header drawer (next test)')
	await page.goto('/app-management')
	const sider = page.getByRole('complementary')
	for (const name of ['Management', 'Settings'])
		await expect(sider.getByRole('menuitem', { name })).toBeVisible()
	for (const name of ['Apps', 'Users', 'Groups', 'Branding'])
		await expect(sider.getByRole('link', { name, exact: true })).toBeVisible()
	await expect(sider.getByRole('link', { name: 'App management' })).toHaveCount(0)
})

test('the collapsed sidebar opens a group on click', async ({ page, isMobile }) => {
	test.skip(isMobile, 'the sidebar is not part of the mobile layout')
	await page.goto('/app-management')
	const sider = page.getByRole('complementary')
	await expect(async () => {
		await page.getByRole('button', { name: 'Collapse sidebar' }).click({ timeout: 1_000 })
		await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible({
			timeout: 1_000,
		})
	}).toPass()
	// The open groups' inline lists play their leave motion before the collapsed Menu drops them, so the sider briefly
	// holds more than its one menu; locators are strict (Playwright, "Locators: Strictness"), so wait for it to settle.
	await expect(sider.getByRole('navigation').getByRole('menu')).toHaveCount(1)
	await sider.getByRole('menuitem', { name: 'Settings' }).click()
	await expect(page.getByRole('menu').getByRole('link', { name: 'Branding' })).toBeVisible()
	// A second click closes it: the pop-out follows clicks, not the pointer resting on the title (antd Menu
	// `triggerSubMenuAction`, "Which action can trigger submenu open/close"; with the default hover it would stay open).
	await sider.getByRole('menuitem', { name: 'Settings' }).click()
	await expect(page.getByRole('menu').getByRole('link', { name: 'Branding' })).toBeHidden()
})

test('the phone drawer shows the same tree', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'the drawer is the mobile navigation')
	await page.goto('/app-management')
	await expect(async () => {
		await page.getByRole('button', { name: 'Menu' }).click()
		await expect(page.getByRole('dialog').getByRole('link', { name: 'Branding' })).toBeVisible({
			timeout: 1_000,
		})
	}).toPass()
	for (const name of ['Apps', 'Users', 'Groups'])
		await expect(page.getByRole('dialog').getByRole('link', { name, exact: true })).toBeVisible()
})
