import {
	type Browser,
	expect,
	type Locator,
	type Page,
	test,
	type TestInfo,
} from '@playwright/test'

import {
	deleteApp,
	deleteGroupsLike,
	seedApp as seedAccessApp,
	seedGroup,
	stubDocuments,
} from './fixtures/access'
import { chooseFile, pngOf } from './fixtures/branding'
import { APP_ID, APP_IDS, CREATED_APP } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { drawerOpened } from './fixtures/drawer'
import { stubApiBase } from './fixtures/env'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

const PROJECTS = ['desktop-light', 'desktop-dark', 'mobile-light']
/** An apps id (a UUID) of the spec's own, distinct per project: the three projects run one after another. */
const ownId = (base: number, testInfo: TestInfo) =>
	`e2e00000-0000-4000-8000-${String(base + PROJECTS.indexOf(testInfo.project.name) + 1).padStart(12, '0')}`
const seedApp = (id: string, name: string, prefix = '') => {
	const { settings, secrets } = stubDocuments(prefix)
	return withDb(db =>
		db.query(
			"INSERT INTO apps (id, provider, name, description, settings, secrets) VALUES ($1, 'dify', $2, 'e2e', $3::jsonb, $4::jsonb) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, settings = EXCLUDED.settings",
			[id, name, settings, secrets],
		),
	)
}
const dropApp = (id: string) => withDb(db => db.query('DELETE FROM apps WHERE id = $1', [id]))
// antd's Table sets data-row-key from rowKey on each body row.
const rowById = (page: Page, id: string) => page.locator(`tr[data-row-key="${id}"]`)
const moreActions = (page: Page, id: string) =>
	rowById(page, id).getByRole('button', { name: 'More actions' })
/** The drawer's provider Select (E1): an antd Select's search box is its combobox, named by the field's label. */
const pickProvider = async (page: Page, drawer: Locator, name: string) => {
	await drawer.getByRole('combobox', { name: /^Provider/ }).click()
	await page.getByTitle(name, { exact: true }).click()
}
/** The Alert under Test connection (E7), found by its title. */
const testResult = (drawer: Locator, title: string) =>
	drawer.getByRole('alert').filter({ hasText: title })

// E9: the Provider column reads "Dify · <type>", and its filter nests the Dify types under "Dify".
test('the table shows every app with its provider and status, and the provider filter narrows it by type', async ({
	page,
}) => {
	await page.goto('/app-management')
	await expect(
		page.getByRole('row', { name: /Stub disabled/ }).getByText('Disabled', { exact: true }),
	).toBeVisible()
	await expect(
		rowById(page, APP_IDS.workflow).getByText('Dify · Workflow', { exact: true }),
	).toBeVisible()
	await page.getByRole('columnheader', { name: 'Provider' }).getByRole('button').click()
	// antd's filter menu shows a provider with types as a submenu, opened on hover (Menu `triggerSubMenuAction`).
	await page.getByRole('menuitem', { name: 'Dify' }).hover()
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

test('delete asks for confirmation and removes the app', async ({ page }, testInfo) => {
	const id = ownId(100, testInfo)
	await seedApp(id, `Delete me ${testInfo.project.name}`)
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
	await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
})

test.describe('create and edit', () => {
	// One project runs at a time, so the created app is removed by name after each test.
	test.afterEach(async () => {
		await withDb(db => db.query('DELETE FROM apps WHERE name = $1', [CREATED_APP.name]))
	})

	test('each opening of the drawer starts from its own app, and New starts with the provider alone', async ({
		page,
	}) => {
		await page.goto('/app-management')
		const first = page.getByRole('dialog').filter({ hasText: 'Edit app configuration - Stub app' })
		await openDrawer(rowById(page, APP_ID).getByRole('button', { name: 'Edit' }), first)
		await expect(first.getByLabel('API base')).toHaveValue(`${stubApiBase}`)
		// The stored key never comes back to the browser: a blank field keeps it (spec §2.3).
		await expect(first.getByLabel('API key')).toHaveValue('')
		await expect(first.getByLabel('API key')).toHaveAttribute('placeholder', 'Leave blank to keep')
		// E8: the provider shows, disabled.
		await expect(first.getByRole('combobox', { name: /^Provider/ })).toBeDisabled()
		await drawerOpened(first)
		await first.getByRole('button', { name: 'Cancel' }).click()
		await expect(first).toBeHidden()

		await rowById(page, APP_IDS.workflow).getByRole('button', { name: 'Edit' }).click()
		const second = page
			.getByRole('dialog')
			.filter({ hasText: 'Edit app configuration - Stub workflow' })
		await expect(second.getByLabel('API base')).toHaveValue(`${stubApiBase}/workflow`)
		await second.getByRole('button', { name: 'Cancel' }).click()
		await expect(second).toBeHidden()

		// Layout B (decision 29): until a provider is picked, the provider is the only row.
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await openDrawer(page.getByRole('button', { name: 'New' }), create)
		await expect(create.getByRole('combobox', { name: /^Provider/ })).toBeEnabled()
		await expect(create.getByLabel('App name')).toHaveCount(0)
		await expect(create.getByLabel('API base')).toHaveCount(0)
		await pickProvider(page, create, 'Dify')
		await expect(create.getByLabel('App name')).toHaveValue('')
		await expect(create.getByLabel('API base')).toHaveValue('')
		await create.getByRole('button', { name: 'Cancel' }).click()
	})

	test('an admin adds a Dify app: the provider, its fields, a passing test, and the save', async ({
		page,
		isMobile,
	}) => {
		await page.goto('/app-management')
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await openDrawer(page.getByRole('button', { name: 'New' }), create)
		await pickProvider(page, create, 'Dify')
		// E3: the required fields carry the asterisk, the others "(optional)".
		await expect(create.getByText('(optional)').first()).toBeVisible()
		await create.getByLabel('App name').fill(CREATED_APP.name)
		await create.getByLabel('App description').fill('Made by the e2e suite')
		// E5: Enter and a comma both make a tag.
		const tags = create.getByRole('combobox', { name: /^App tags/ })
		await tags.fill('alpha')
		await tags.press('Enter')
		await tags.fill('beta,')
		await expect(create.locator('.ant-select-selection-item', { hasText: 'alpha' })).toBeVisible()
		await expect(create.locator('.ant-select-selection-item', { hasText: 'beta' })).toBeVisible()
		// A comma closes the tag list (rc-select closes it after a token split), so no Escape: with the list closed,
		// Escape would reach the Drawer and close it (antd Drawer `keyboard`, on by default).
		await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0)
		// E4: the image through the Upload button; the preview shows it before the save.
		await chooseFile(page, 'Choose image', {
			name: 'icon.png',
			mimeType: 'image/png',
			buffer: await pngOf(512, 512),
		})
		await expect(create.getByRole('img', { name: 'App icon' })).toBeVisible()
		await create.getByLabel('API base').fill(stubApiBase)
		await create.getByLabel('API key').fill('app-e2e')
		// The app type stays Chatbot; the stub's chat app reports `chat`.
		await create.getByRole('button', { name: 'Test connection' }).click()
		await expect(testResult(create, 'Connected')).toBeVisible()
		if (isMobile) {
			// Spec §4.1: on a phone the labels sit above their fields (responsive spans, xs: 24).
			const label = await create.locator('label', { hasText: 'App name' }).boundingBox()
			const input = await create.getByLabel('App name').boundingBox()
			expect(label!.y + label!.height).toBeLessThanOrEqual(input!.y + 1)
		}
		await create.getByRole('button', { name: 'OK' }).click()
		await expect(page.getByText('App configuration added')).toBeVisible()

		const row = page.getByRole('row', { name: new RegExp(CREATED_APP.name) })
		await expect(row).toBeVisible()
		await expect(row.getByText('Made by the e2e suite')).toBeVisible()
		// The icon was stored as a PNG and the icon route serves it (spec §4.4).
		await expect(row.locator('img')).toHaveAttribute('src', /\/api\/apps\/[^/]+\/icon$/)
		await expect
			.poll(() => row.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth))
			.toBeGreaterThan(0)
	})

	// Spec §9: the test's mismatch, refused and unreachable scenarios against the stub; a connection change clears it.
	test('Test connection warns of another type, and reports a refused key and an unreachable base', async ({
		page,
	}) => {
		await page.goto('/app-management')
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await openDrawer(page.getByRole('button', { name: 'New' }), create)
		await pickProvider(page, create, 'Dify')
		const test = create.getByRole('button', { name: 'Test connection' })

		await create.getByLabel('API base').fill(stubApiBase)
		await create.getByLabel('API key').fill('app-e2e')
		await create.getByRole('combobox', { name: /^App type/ }).click()
		await page.getByTitle('Workflow', { exact: true }).click()
		await test.click()
		await expect(testResult(create, 'Connected, but the type differs')).toContainText(
			'The provider reports this app as Chatbot, not Workflow.',
		)

		await create.getByLabel('API key').fill('app-refused')
		// A connection field changed: the old result is gone (E7).
		await expect(testResult(create, 'Connected, but the type differs')).toHaveCount(0)
		await test.click()
		await expect(testResult(create, 'The key was refused')).toBeVisible()

		await create.getByLabel('API key').fill('app-e2e')
		await create.getByLabel('API base').fill(`${stubApiBase}/unreachable`)
		await test.click()
		await expect(testResult(create, 'The provider could not be reached')).toBeVisible()
		await create.getByRole('button', { name: 'Cancel' }).click()
	})

	// Spec §2.3 and §9: the provider stays, a blank key keeps the stored one (the chat still works), the icon is replaced
	// and removed.
	test('an edit keeps the provider and a blank key, and replaces then removes the icon', async ({
		page,
	}, testInfo) => {
		const id = ownId(300, testInfo)
		await seedApp(id, `Edit me ${testInfo.project.name}`)
		try {
			await page.goto('/app-management')
			const row = rowById(page, id)
			const edit = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' })
			await openDrawer(row.getByRole('button', { name: 'Edit' }), edit)
			await chooseFile(page, 'Choose image', {
				name: 'icon.png',
				mimeType: 'image/png',
				buffer: await pngOf(64, 64),
			})
			await edit.getByRole('button', { name: 'Update' }).click()
			await expect(row.locator('img')).toHaveAttribute('src', /\/api\/apps\/[^/]+\/icon$/)
			const stored = await withDb(async db => {
				const { rows } = await db.query<{ secrets: { apiKey: string } }>(
					'SELECT secrets FROM apps WHERE id = $1',
					[id],
				)
				return rows[0]?.secrets
			})
			expect(stored).toEqual({ apiKey: 'app-e2e' })
			// The saved drawer slides out first: while it is still visible, openDrawer would take it for the new one.
			await expect(edit).toBeHidden()

			await openDrawer(row.getByRole('button', { name: 'Edit' }), edit)
			await edit.getByRole('button', { name: 'Remove' }).click()
			await edit.getByRole('button', { name: 'Update' }).click()
			// E11: no image, so Dify's fallback icon (antd icons are role="img", named after the icon).
			await expect(row.getByRole('img', { name: 'apartment' })).toBeVisible()

			await page.goto(`/chat/${id}?isNewCvst=1`)
			await page.getByPlaceholder('Type a message').fill('still here')
			await page.keyboard.press('Enter')
			await expect(page.getByText('Echo: still here', { exact: true })).toBeVisible()
		} finally {
			await dropApp(id)
		}
	})

	// Spec §2.3: a row whose stored settings fail is marked, hidden from the gallery, and repaired from its Edit.
	test('an app with invalid settings is marked, hidden from the gallery, and repaired from its Edit', async ({
		page,
	}, testInfo) => {
		const id = ownId(400, testInfo)
		const name = `Broken ${testInfo.project.name}`
		await seedApp(id, name)
		await withDb(db =>
			db.query(
				`UPDATE apps SET settings = jsonb_set(settings, '{appType}', 'null') WHERE id = $1`,
				[id],
			),
		)
		try {
			await page.goto('/apps')
			// The gallery has drawn its cards (the seeded stub app's), so the next count is not of an empty page.
			await expect(page.locator(`a[href="/chat/${APP_ID}"]`)).toBeVisible()
			await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveCount(0)
			await page.goto('/app-management')
			const row = rowById(page, id)
			await expect(row.getByText('Invalid settings', { exact: true })).toBeVisible()
			const edit = page.getByRole('dialog').filter({ hasText: `Edit app configuration - ${name}` })
			await openDrawer(row.getByRole('button', { name: 'Edit' }), edit)
			// The form opens on Dify's defaults; the admin fills the connection again (the key stays blank: kept).
			await expect(edit.getByLabel('API base')).toHaveValue('')
			await edit.getByLabel('API base').fill(stubApiBase)
			await edit.getByRole('button', { name: 'Update' }).click()
			await expect(row.getByText('Enabled', { exact: true })).toBeVisible()
			await expect(row.getByText('Dify · Chatbot', { exact: true })).toBeVisible()
		} finally {
			await dropApp(id)
		}
	})
})

// Cosmetic sweep 1, item 6: both admin tables offer items per page and show the total. antd's pagination style hides
// `.ant-pagination-options` below screenSM (es/pagination/style/index.js), and the quick jumper shows only above one page.
test('the apps table offers items per page like the users table', async ({ page, isMobile }) => {
	test.skip(isMobile, 'antd hides the pagination options below screenSM')
	for (const path of ['/app-management', '/user-management']) {
		await page.goto(path)
		const pagination = page.locator('.ant-table-pagination')
		await expect(pagination.locator('.ant-pagination-options-size-changer')).toBeVisible()
		await expect(pagination.getByText(/^Total (apps|users): \d+$/)).toBeVisible()
	}
})

/**
 * Clicks a control that opens a drawer and waits for the drawer. /app-management renders no hydration-only signal
 * (no ClientDateTime), and a click before hydration does nothing (Playwright docs, "Navigations > Hydration"), so the
 * click is retried with its outcome (Playwright `expect.toPass`); it is repeated only while the drawer is still
 * closed, since an open drawer's mask would take the click.
 */
const openDrawer = async (control: Locator, drawer: Locator) => {
	await expect(async () => {
		if (!(await drawer.isVisible())) await control.click()
		await expect(drawer).toBeVisible({ timeout: 2_000 })
	}).toPass()
}

/**
 * Narrows an access picker found by the start of its name (the label ends with "(optional)", E3; the radio "Selected
 * groups and people" contains "groups" and "people" further in) and picks the option by its title (antd Select options
 * carry a title; e2e/admin-groups.spec.ts).
 */
const pick = async (
	page: Page,
	drawer: Locator,
	picker: 'Groups' | 'People',
	label: string,
	filter: string,
) => {
	await drawer.getByRole('combobox', { name: new RegExp(`^${picker}`) }).fill(filter)
	await page.getByTitle(label, { exact: true }).click()
	await expect(drawer.locator('.ant-select-selection-item', { hasText: label })).toBeVisible()
}

/** The app's name, access mode and grant counts as the database holds them. */
const storedAccess = (appId: string) =>
	withDb(async db => {
		const {
			rows: [app],
		} = await db.query<{ name: string; access_mode: string }>(
			'SELECT name, access_mode FROM apps WHERE id = $1',
			[appId],
		)
		// count(*) is a bigint, which node-postgres returns as a string (it parses no int8 into a number), hence Number().
		const {
			rows: [groups],
		} = await db.query<{ n: string }>(
			'SELECT COUNT(*) AS n FROM app_group_grants WHERE app_id = $1',
			[appId],
		)
		const {
			rows: [users],
		} = await db.query<{ n: string }>(
			'SELECT COUNT(*) AS n FROM app_user_grants WHERE app_id = $1',
			[appId],
		)
		return {
			name: app?.name,
			mode: app?.access_mode,
			groups: Number(groups?.n),
			users: Number(users?.n),
		}
	})

test.describe('app access in the drawer (B3 spec §4.4)', () => {
	const PASSWORD = 'appacc-pass-1'
	const tag = () => `appacc-${test.info().project.name}`
	const memberEmail = () => `${tag()}@e2e.local`
	const personEmail = () => `${tag()}-direct@e2e.local`
	const person = () => `Direct person (${personEmail()})`
	const seededName = () => `Drawer ${tag()}`
	let appId: string | undefined
	let memberId: string

	/** Signs the account in from a fresh context: its gallery links the app (the card is a link to /chat/<id>). */
	const expectGalleryShows = async (browser: Browser, email: string, id: string) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		try {
			const page = await context.newPage()
			await signInAs(page, email, PASSWORD)
			await expect(page.locator(`a[href="/chat/${id}"]`)).toBeVisible()
		} finally {
			await context.close()
		}
	}

	test.beforeEach(async () => {
		appId = undefined
		memberId = await seedUser({ email: memberEmail(), password: PASSWORD, name: 'App access user' })
		await seedUser({ email: personEmail(), password: PASSWORD, name: 'Direct person' })
		appId = await seedAccessApp({ name: seededName(), accessMode: 'restricted' })
	})
	test.afterEach(async () => {
		// By id; its grants go with it (ON DELETE CASCADE).
		if (appId) await deleteApp(appId)
		await deleteGroupsLike(`%${tag()}`)
		await deleteUsersLike(`${tag()}%`)
	})

	test('a restricted app with no grant is tagged Admins only; granting a group and a person opens it to them', async ({
		page,
		browser,
	}) => {
		const id = appId!
		await seedGroup({ name: `Group ${tag()}`, memberIds: [memberId] })
		await page.goto('/app-management')
		const row = rowById(page, id)
		await expect(row.getByText('Admins only')).toBeVisible()

		const drawer = page
			.getByRole('dialog')
			.filter({ hasText: `Edit app configuration - ${seededName()}` })
		await openDrawer(row.getByRole('button', { name: 'Edit' }), drawer)
		await pick(page, drawer, 'Groups', `Group ${tag()}`, `Group ${tag()}`)
		await pick(page, drawer, 'People', person(), personEmail())
		await drawer.getByRole('button', { name: 'Update' }).click()
		await expect(page.getByText('App configuration updated')).toBeVisible()
		await expect(row.getByText('Groups: 1 · People: 1')).toBeVisible()

		// Spec §8: the member reaches the app through its group, the person through the direct grant.
		await expectGalleryShows(browser, memberEmail(), id)
		await expectGalleryShows(browser, personEmail(), id)

		// The drawer is found by its title's fixed part.
		await row.getByRole('button', { name: 'Edit' }).click()
		const again = page.getByRole('dialog').filter({ hasText: 'Edit app configuration' })
		// antd draws a button-style radio's <input> at 0×0, so the visible label is clicked.
		await again.getByText('Everyone', { exact: true }).click()
		await expect(again.getByRole('radio', { name: 'Everyone' })).toBeChecked()
		await again.getByRole('button', { name: 'Update' }).click()
		await expect(row.getByText('Everyone', { exact: true })).toBeVisible()
		// Deviation 4: an app open to everyone keeps no grant.
		expect(await storedAccess(id)).toMatchObject({ mode: 'everyone', groups: 0, users: 0 })
	})

	test('a new app starts closed', async ({ page }) => {
		await page.goto('/app-management')
		const create = page.getByRole('dialog').filter({ hasText: 'New app configuration' })
		await openDrawer(page.getByRole('button', { name: 'New' }), create)
		await pickProvider(page, create, 'Dify')
		await expect(create.getByRole('radio', { name: 'Selected groups and people' })).toBeChecked()
		await expect(create.getByRole('combobox', { name: /^Groups/ })).toBeVisible()
		await create.getByRole('button', { name: 'Cancel' }).click()
	})

	// Deviation 3 and ruling M13: a pick deleted meanwhile is the pickers' own error, the save writes nothing, and the
	// error clears when a pick changes.
	test('a group deleted after the page loaded is refused on the pickers, and the error clears on a new pick', async ({
		page,
	}) => {
		const id = appId!
		const gone = `Gone ${tag()}`
		await seedGroup({ name: gone })
		await page.goto('/app-management')
		const drawer = page
			.getByRole('dialog')
			.filter({ hasText: `Edit app configuration - ${seededName()}` })
		await openDrawer(rowById(page, id).getByRole('button', { name: 'Edit' }), drawer)
		await pick(page, drawer, 'Groups', gone, gone)
		await deleteGroupsLike(gone)
		await drawer.getByRole('button', { name: 'Update' }).click()
		const error = drawer.getByText(
			'A picked group or account no longer exists. Reload the page and pick again.',
		)
		// The server cannot tell which picker held the id, so both carry the error.
		await expect(error).toHaveCount(2)
		await expect(error.first()).toBeVisible()
		// One transaction: no grant was stored either.
		expect(await storedAccess(id)).toEqual({
			name: seededName(),
			mode: 'restricted',
			groups: 0,
			users: 0,
		})
		await pick(page, drawer, 'People', person(), personEmail())
		await expect(error).toHaveCount(0)
	})
})
