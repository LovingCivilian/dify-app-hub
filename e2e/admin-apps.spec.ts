import { expect, type Page, test, type TestInfo } from '@playwright/test'

import { APP_ID, CREATED_APP } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { stubApiBase } from './fixtures/env'

const PROJECTS = ['desktop-light', 'desktop-dark', 'mobile-light']
/** A dify_apps id (36 characters) of the spec's own, distinct per project: the three projects run one after another. */
const ownId = (base: number, testInfo: TestInfo) =>
	`e2e00000-0000-4000-8000-${String(base + PROJECTS.indexOf(testInfo.project.name) + 1).padStart(12, '0')}`
const seedApp = (id: string, name: string, apiBase: string) =>
	withDb(db =>
		db.execute(
			'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = ?, api_base = ?',
			[id, name, 'chat', 'e2e', apiBase, 'app-e2e', name, apiBase],
		),
	)
const dropApp = (id: string) => withDb(db => db.execute('DELETE FROM dify_apps WHERE id = ?', [id]))
// antd's Table sets data-row-key from rowKey on each body row.
const rowById = (page: Page, id: string) => page.locator(`tr[data-row-key="${id}"]`)
const moreActions = (page: Page, id: string) =>
	rowById(page, id).getByRole('button', { name: 'More actions' })

test('the table shows every app with its status, and the type filter narrows it', async ({
	page,
}) => {
	await page.goto('/app-management')
	await expect(
		page.getByRole('row', { name: /Stub disabled/ }).getByText('Disabled', { exact: true }),
	).toBeVisible()
	await page.getByRole('columnheader', { name: 'Type' }).getByRole('button').click()
	// The filter dropdown lists the modes as checkable menu items (antd Table filters).
	await page.getByRole('menuitem', { name: 'Workflow', exact: true }).click()
	await page.getByRole('button', { name: 'OK' }).click()
	await expect(page.getByRole('row', { name: /Stub workflow/ })).toBeVisible()
	await expect(page.getByRole('row', { name: /Stub no-site/ })).toBeVisible()
	await expect(page.getByRole('row', { name: /Stub agent/ })).toHaveCount(0)
})

test('search narrows the table', async ({ page }) => {
	await page.goto('/app-management')
	await page.getByRole('textbox', { name: 'Search apps' }).fill('chatflow')
	await expect(page.getByRole('row', { name: /Stub chatflow/ })).toBeVisible()
	await expect(rowById(page, APP_ID)).toHaveCount(0)
})

test('user view is a link that opens the chat in a new tab', async ({ page }) => {
	await page.goto('/app-management')
	await moreActions(page, APP_ID).click()
	const link = page.getByRole('menuitem', { name: 'User view' }).getByRole('link')
	await expect(link).toHaveAttribute('href', `/chat/${APP_ID}`)
	await expect(link).toHaveAttribute('target', '_blank')
})

test('sync info refreshes the app from Dify', async ({ page }, testInfo) => {
	const id = ownId(200, testInfo)
	await seedApp(id, `Sync me ${testInfo.project.name}`, `${stubApiBase}${CREATED_APP.prefix}`)
	try {
		await page.goto('/app-management')
		await moreActions(page, id).click()
		await page.getByRole('menuitem', { name: 'Sync app info' }).click()
		// The stub's /info for this prefix answers the created app's name; router.refresh() shows it.
		await expect(rowById(page, id)).toContainText(CREATED_APP.name)
	} finally {
		await dropApp(id)
	}
})

test('delete asks for confirmation and removes the app', async ({ page }, testInfo) => {
	const id = ownId(100, testInfo)
	await seedApp(id, `Delete me ${testInfo.project.name}`, stubApiBase)
	try {
		await page.goto('/app-management')
		await moreActions(page, id).click()
		await page.getByRole('menuitem', { name: 'Delete' }).click()
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
		await expect(rowById(page, id)).toHaveCount(0)
	} finally {
		await dropApp(id)
	}
})

test('on a phone the table scrolls inside its container and More stays reachable', async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, 'a phone-width check')
	await page.goto('/app-management')
	const fits = (selector: string) =>
		page.evaluate(sel => {
			const el = document.querySelector(sel)
			return !!el && el.scrollWidth <= el.clientWidth
		}, selector)
	expect(await fits('html')).toBe(true)
	expect(await fits('main.ant-layout-content')).toBe(true)
	const more = moreActions(page, APP_ID)
	await more.scrollIntoViewIfNeeded()
	await expect(more).toBeInViewport()
	await more.click()
	await expect(page.getByRole('menuitem', { name: 'Sync app info' })).toBeVisible()
})
