import { expect, type Page, test, type TestInfo } from '@playwright/test'

import { APP_ID, APP_IDS, CREATED_APP } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { drawerOpened } from './fixtures/drawer'
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
	await page.getByRole('textbox', { name: 'Search apps' }).fill('no such app')
	await expect(page.getByText('No apps match your search')).toBeVisible()
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

test.describe('create and edit', () => {
	// One project runs at a time, so the created app is removed by name after each test.
	test.afterEach(async () => {
		await withDb(db => db.execute('DELETE FROM dify_apps WHERE name = ?', [CREATED_APP.name]))
	})

	test('an admin creates an app from its Dify API base and key, then disables it', async ({
		page,
	}) => {
		await page.goto('/app-management')
		await page.getByRole('button', { name: 'New' }).click()
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await create.getByLabel('API Base').fill(`${stubApiBase}${CREATED_APP.prefix}`)
		await create.getByLabel('API Secret').fill('app-e2e')
		await create.getByRole('button', { name: 'OK' }).click()

		const row = page.getByRole('row', { name: new RegExp(CREATED_APP.name) })
		await expect(row).toBeVisible()
		// The created app's stub site names an image icon (Task 1).
		await expect(row.locator('img')).toHaveAttribute('src', /stub-image\.png/)

		await row.getByRole('button', { name: 'Edit' }).click()
		const edit = page
			.getByRole('dialog')
			.filter({ hasText: `Edit app configuration - ${CREATED_APP.name}` })
		await edit.getByRole('switch', { name: 'App status' }).click()
		await edit.getByRole('button', { name: 'Update' }).click()
		await expect(row.getByText('Disabled')).toBeVisible()

		await row.getByRole('button', { name: 'Edit' }).click()
		await expect(
			page
				.getByRole('dialog')
				.filter({ hasText: `Edit app configuration - ${CREATED_APP.name}` })
				.getByRole('switch', { name: 'App status' }),
		).not.toBeChecked()
	})

	test('a Dify error body instead of app info keeps the drawer open with a translated error', async ({
		page,
	}) => {
		await page.goto('/app-management')
		await page.getByRole('button', { name: 'New' }).click()
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		// An unknown stub path answers Dify's 404 JSON body, which lib/api resolves as a value (Review Focus 1).
		await create.getByLabel('API Base').fill(`${stubApiBase}/nope`)
		await create.getByLabel('API Secret').fill('app-e2e')
		await create.getByRole('button', { name: 'OK' }).click()
		await expect(
			page.getByText('Could not reach the Dify app. Check the API Base and API Secret.'),
		).toBeVisible()
		await expect(create).toBeVisible()
		await expect(page.getByRole('row', { name: /nope/ })).toHaveCount(0)
	})

	test('each opening of the drawer starts from its own app, and New starts empty', async ({
		page,
	}) => {
		await page.goto('/app-management')
		await rowById(page, APP_ID).getByRole('button', { name: 'Edit' }).click()
		const first = page.getByRole('dialog').filter({ hasText: 'Edit app configuration - Stub app' })
		await expect(first.getByLabel('API Base')).toHaveValue(`${stubApiBase}`)
		await drawerOpened(first)
		await first.getByRole('button', { name: 'Cancel' }).click()
		// The drawer keeps its title and form while it slides out (cleared in afterOpenChange).
		await expect(first).toContainText('Edit app configuration - Stub app')
		await expect(first.getByLabel('API Base')).toHaveValue(`${stubApiBase}`)
		await expect(first).toBeHidden()

		await rowById(page, APP_IDS.workflow).getByRole('button', { name: 'Edit' }).click()
		const second = page
			.getByRole('dialog')
			.filter({ hasText: 'Edit app configuration - Stub workflow' })
		await expect(second.getByLabel('API Base')).toHaveValue(`${stubApiBase}/workflow`)
		await second.getByRole('button', { name: 'Cancel' }).click()
		await expect(second).toBeHidden()

		await page.getByRole('button', { name: 'New' }).click()
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await expect(create.getByLabel('API Base')).toHaveValue('')
		await expect(create.getByLabel('API Secret')).toHaveValue('')
		await create.getByRole('button', { name: 'Cancel' }).click()
	})
})

test.describe('annotations', () => {
	const chatflow = APP_IDS['advanced-chat']

	test('the menu offers annotations for chat apps only', async ({ page }) => {
		await page.goto('/app-management')
		await moreActions(page, APP_IDS.workflow).click()
		await expect(page.getByRole('menuitem', { name: 'Sync app info' })).toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Annotations' })).toHaveCount(0)
		await page.keyboard.press('Escape')
		await moreActions(page, chatflow).click()
		await expect(page.getByRole('menuitem', { name: 'Annotations' })).toBeVisible()
	})

	test('an admin adds, finds, edits and deletes an annotation', async ({ page }, testInfo) => {
		const question = `How do I reset? ${testInfo.project.name}`
		await page.goto('/app-management')
		await moreActions(page, chatflow).click()
		await page.getByRole('menuitem', { name: 'Annotations' }).click()
		// Dialogs by accessible name: a `hasText` filter would also match the drawer (its toolbar says "New
		// annotation"), and the drawer's cells carry their text as aria-label (other specs' answers, too).
		const drawer = page.getByRole('dialog', { name: 'Annotations' })
		await expect(drawer.getByRole('table')).toBeVisible()

		await drawer.getByRole('button', { name: 'New annotation' }).click()
		const modal = page.getByRole('dialog', { name: 'New annotation' })
		await modal.getByLabel('Question').fill(question)
		await modal.getByLabel('Answer').fill('Open the account menu.')
		await modal.getByRole('button', { name: 'OK' }).click()
		// By this test's own question: chat-feedback.spec.ts leaves an annotation per project in the same app.
		const row = drawer.getByRole('row', { name: question })
		await expect(row).toBeVisible()

		// Keyword search goes to Dify (the stub filters question or answer).
		await drawer.getByRole('searchbox', { name: 'Search annotations' }).fill('no such text')
		await page.keyboard.press('Enter')
		await expect(row).toHaveCount(0)
		await drawer.getByRole('searchbox', { name: 'Search annotations' }).fill(testInfo.project.name)
		await page.keyboard.press('Enter')
		await expect(row).toBeVisible()

		await row.getByRole('button', { name: 'Edit' }).click()
		const edit = page.getByRole('dialog', { name: 'Edit annotation' })
		await edit.getByLabel('Answer').fill('Open the account menu, then Reset.')
		await edit.getByRole('button', { name: 'OK' }).click()
		await expect(row).toContainText('then Reset')

		// A new annotation starts from empty fields after an edit.
		await drawer.getByRole('button', { name: 'New annotation' }).click()
		const fresh = page.getByRole('dialog', { name: 'New annotation' })
		await expect(fresh.getByLabel('Question')).toHaveValue('')
		await expect(fresh.getByLabel('Answer')).toHaveValue('')
		await fresh.getByRole('button', { name: 'Cancel' }).click()
		await expect(fresh).toBeHidden()

		await row.getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete' }).last().click()
		await expect(row).toHaveCount(0)
	})

	test('closing the drawer resets its search and page', async ({ page }, testInfo) => {
		const question = `Reset me ${testInfo.project.name}`
		await page.goto('/app-management')
		await moreActions(page, chatflow).click()
		await page.getByRole('menuitem', { name: 'Annotations' }).click()
		const drawer = page.getByRole('dialog', { name: 'Annotations' })
		await drawer.getByRole('button', { name: 'New annotation' }).click()
		const modal = page.getByRole('dialog', { name: 'New annotation' })
		await modal.getByLabel('Question').fill(question)
		await modal.getByLabel('Answer').fill('Reopen and see me.')
		await modal.getByRole('button', { name: 'OK' }).click()
		const row = drawer.getByRole('row', { name: question })
		await expect(row).toBeVisible()
		await drawer.getByRole('searchbox', { name: 'Search annotations' }).fill('no such text')
		await page.keyboard.press('Enter')
		await expect(row).toHaveCount(0)

		await drawerOpened(drawer)
		await drawer.getByRole('button', { name: 'Close', exact: true }).click()
		// The panel stays while the drawer slides out (the record is cleared in afterOpenChange).
		await expect(drawer.getByRole('table')).toBeVisible()
		await expect(drawer).toBeHidden()
		await moreActions(page, chatflow).click()
		await page.getByRole('menuitem', { name: 'Annotations' }).click()
		const reopened = page.getByRole('dialog', { name: 'Annotations' })
		await expect(reopened.getByRole('searchbox', { name: 'Search annotations' })).toHaveValue('')
		const rowAgain = reopened.getByRole('row', { name: question })
		await expect(rowAgain).toBeVisible()
		await rowAgain.getByRole('button', { name: 'Delete' }).click()
		await page.getByRole('button', { name: 'Delete' }).last().click()
		await expect(rowAgain).toHaveCount(0)
	})
})
