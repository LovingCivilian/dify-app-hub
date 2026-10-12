import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'

import { chooseFile, demoLogo, resetBranding } from './fixtures/branding'
import { APP_ID, APP_IDS } from './fixtures/constants'
import { waitForHydration } from './fixtures/hydration'

/**
 * Readiness is asserted with web-first assertions: Playwright discourages `networkidle`
 * ("rely on web assertions to assess readiness instead",
 * https://playwright.dev/docs/api/class-page#page-goto, `waitUntil`).
 * The route group layouts gate on the server (ADR-0018), so no fullscreen Spin is rendered while a
 * session loads; the admin tables show their own Spin while they fetch, so every page first waits
 * for no antd Spin to be active, then for the header and for seeded data that only the finished
 * page shows.
 */
async function noSpinner(page: Page) {
	await expect(page.locator('.ant-spin-fullscreen')).toHaveCount(0)
	await expect(page.locator('.ant-spin-spinning')).toHaveCount(0)
}

const header = (page: Page) => page.locator('header.ant-layout-header')
const stubApp = (page: Page) => page.getByText('Stub app').first()
/** The Sender's box by its placeholder: the agent app's required "Topic" field is a textbox too. */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** The run button of the workflow and completion views; antd adds a loading icon to its name while a run streams. */
const runButton = (page: Page) => page.getByRole('button', { name: 'Run' })

const signedInPages: Record<string, { path: string; ready: (page: Page) => Promise<void> }> = {
	apps: {
		path: '/apps',
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(stubApp(page)).toBeVisible()
			await expect(page.getByText('🤖').first()).toBeVisible()
		},
	},
	admin: {
		path: '/app-management',
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(stubApp(page)).toBeVisible()
			await expect(page.getByText('🤖').first()).toBeVisible()
		},
	},
	users: {
		path: '/user-management',
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(page.getByText('admin@e2e.local').first()).toBeVisible()
		},
	},
	chat: {
		// A new conversation: /chat/<id> alone reopens whichever conversation the run touched last.
		path: `/chat/${APP_ID}?isNewCvst=1`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			// The welcome panel's opening statement and the site's disclaimer under the sender mark the loaded chat view.
			await expect(page.getByText('Hello from the stub')).toBeVisible()
			await expect(page.getByText('Answers come from the stub.')).toBeVisible()
			await expect(page.getByRole('textbox').first()).toBeEditable()
		},
	},
	// The stub's agent default scenario: a tool call shown as a thought chain (opened), then the answer.
	'chat-agent': {
		path: `/chat/${APP_IDS['agent-chat']}?isNewCvst=1`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			// The agent app requires a topic before anything can be sent.
			await page.getByLabel('Topic').fill('tea')
			await senderBox(page).fill('hello agent')
			await page.keyboard.press('Enter')
			await expect(page.getByText('Echo: hello agent', { exact: true })).toBeVisible()
			await page.getByText('Used web_search', { exact: true }).click()
			await expect(page.getByText('{"q":"hello"}', { exact: true })).toBeVisible()
		},
	},
	// The stub's chatflow `hitl` scenario: the run pauses at the Review node with a human input form.
	'chat-hitl': {
		path: `/chat/${APP_IDS['advanced-chat']}?isNewCvst=1`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await senderBox(page).fill('please hitl')
			await page.keyboard.press('Enter')
			await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible()
		},
	},
	workflow: {
		path: `/chat/${APP_IDS.workflow}`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await page.getByLabel('Topic').fill('tea')
			await runButton(page).click()
			await expect(page.getByText('A short note about tea.')).toBeVisible()
			await expect(page.getByRole('img', { name: 'stub-image.png' })).toBeVisible()
		},
	},
	completion: {
		path: `/chat/${APP_IDS.completion}`,
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await page.getByLabel('Topic').fill('coffee')
			await runButton(page).click()
			await expect(page.getByText('A short note about coffee.')).toBeVisible()
		},
	},
}

/**
 * The server renders the light theme and the client applies the preferred scheme after hydration
 * (`color-scheme: dark` on `<html>`), so dark projects wait for that style; `animations: 'disabled'`
 * then fast-forwards the antd colour transitions that hydration starts
 * (https://playwright.dev/docs/api/class-page#page-screenshot, option `animations`).
 */
async function capture(page: Page, name: string, testInfo: TestInfo) {
	if (testInfo.project.use.colorScheme === 'dark') {
		await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark')
	}
	await page.screenshot({
		path: `e2e/screenshots/${name}-${testInfo.project.name}.png`,
		fullPage: true,
		animations: 'disabled',
	})
}

// A signed-in visitor is redirected away from /login, so the login page is shot signed out
// (documented reset: https://playwright.dev/docs/auth).
test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('screenshot login', async ({ page }, testInfo) => {
		await page.goto('/login')
		await noSpinner(page)
		await expect(page.locator('.ant-card')).toBeVisible()
		await capture(page, 'login', testInfo)
	})

	test('screenshot forgot-password', async ({ page }, testInfo) => {
		await page.goto('/forgot-password')
		await expect(page.locator('.ant-card')).toBeVisible()
		await capture(page, 'forgot-password', testInfo)
	})

	test('screenshot reset-password', async ({ page }, testInfo) => {
		await page.goto('/reset-password?token=screenshot')
		await expect(page.getByLabel('New password')).toBeVisible()
		await capture(page, 'reset-password', testInfo)
	})

	test('screenshot reset-password-invalid', async ({ page }, testInfo) => {
		await page.goto('/reset-password')
		await expect(page.getByText('This reset link is invalid')).toBeVisible()
		await capture(page, 'reset-password-invalid', testInfo)
	})
})

for (const [name, { path, ready }] of Object.entries(signedInPages)) {
	test(`screenshot ${name}`, async ({ page }, testInfo) => {
		await page.goto(path)
		await ready(page)
		await capture(page, name, testInfo)
	})
}

test('screenshot app-drawer', async ({ page }, testInfo) => {
	await page.goto('/app-management')
	await page.locator(`tr[data-row-key="${APP_ID}"]`).getByRole('button', { name: 'Edit' }).click()
	await expect(page.getByRole('dialog').getByLabel('API Base')).toHaveValue(/5399/)
	await capture(page, 'app-drawer', testInfo)
})

test('screenshot user-drawer', async ({ page }, testInfo) => {
	await page.goto('/user-management')
	await page.getByRole('button', { name: 'Add user' }).click()
	await expect(page.getByRole('dialog').getByLabel('Name')).toBeVisible()
	await capture(page, 'user-drawer', testInfo)
})

/**
 * Waits until the page shows one shell. React streams a segment into a hidden `<div hidden id="S:…">` and an inline
 * script swaps it in for its Suspense fallback (react.dev `renderToPipeableStream`, "Streaming more content as it
 * loads"), which can happen after the load event; until then the DOM holds two headers (seen once on /apps, where the
 * `header(...)` CSS locator above matched both and failed strict mode, Playwright "Locators: Strictness"). One header,
 * shown as the banner landmark (role locators skip hidden elements, Playwright `getByRole` `includeHidden`), marks the
 * settled page, so the checks after it see one copy of everything.
 */
async function shellSettled(page: Page) {
	await expect(page.locator('header.ant-layout-header')).toHaveCount(1)
	await expect(page.getByRole('banner')).toBeVisible()
}

/**
 * Waits until every visible matched image has loaded (MDN HTMLImageElement.naturalWidth: 0 while "the image data is not
 * available"); `evaluateAll` re-resolves the locator on each poll (Playwright `locator.evaluateAll`, `filter` `visible`).
 */
async function imagesLoaded(images: Locator) {
	const visible = images.filter({ visible: true })
	await expect(visible.first()).toBeVisible()
	await expect
		.poll(() =>
			visible.evaluateAll(
				(elements: HTMLImageElement[]) =>
					elements.length > 0 && elements.every(element => element.naturalWidth > 0),
			),
		)
		.toBe(true)
}

/**
 * Waits until an element shows at full opacity, its ancestors included (MDN `opacity`: it "applies to the element as a
 * whole, including its contents"; MDN `Window.getComputedStyle`). An antd pop-up mounts at opacity 0 and fades in through
 * its motion classes; `animations: 'disabled'` fast-forwards running finite animations to completion (Playwright
 * `page.screenshot`), not a fade that has not started, so a shot taken in that first phase shows nothing, although the
 * element already counts as visible (seen: the collapsed sider's pop-out at opacity 0 in its `appear-start` phase).
 */
async function fullyOpaque(element: Locator) {
	await expect
		.poll(() =>
			element.evaluate(start => {
				let opacity = 1
				for (let node: Element | null = start; node; node = node.parentElement)
					opacity *= Number(getComputedStyle(node).opacity)
				return opacity
			}),
		)
		.toBe(1)
}

/** /app-management with its seeded table, as the `admin` shot waits for it, after the shell has settled. */
async function openAppManagement(page: Page) {
	await page.goto('/app-management')
	await shellSettled(page)
	await noSpinner(page)
	await expect(stubApp(page)).toBeVisible()
	await expect(page.getByText('🤖').first()).toBeVisible()
}

/**
 * Opens the admin drawer below md. A click before hydration does nothing, so it is retried with its outcome (Playwright
 * `expect.toPass`, given a timeout since it defaults to none), and only while the drawer is closed: an open drawer's
 * mask would take the click (as openDrawer, e2e/admin-apps.spec.ts).
 */
async function openAdminDrawer(page: Page) {
	const drawerLink = page.getByRole('dialog').getByRole('link', { name: 'Branding' })
	await expect(async () => {
		if (!(await drawerLink.isVisible()))
			await page.getByRole('button', { name: 'Menu' }).click({ timeout: 2_000 })
		await expect(drawerLink).toBeVisible({ timeout: 1_000 })
	}).toPass({ timeout: 30_000 })
	await fullyOpaque(drawerLink)
}

const DEMO_BRAND = 'Acme AI Hub'

// The Branding page in database mode (settings spec §5.3), a demo brand saved through it, and the grouped admin
// navigation (§5.1). The brand is global state and the suite runs serially, so each test ends on the built-in brand.
test.describe('branding', () => {
	test.afterEach(async () => {
		await resetBranding()
	})

	test('screenshot settings-branding', async ({ page }, testInfo) => {
		await page.goto('/settings/branding')
		await shellSettled(page)
		await noSpinner(page)
		await expect(page.getByText('Branding is stored in the database.')).toBeVisible()
		await expect(page.getByText('Not saved yet')).toBeVisible()
		await imagesLoaded(page.getByRole('banner').locator('img'))
		await capture(page, 'settings-branding', testInfo)
	})

	test('screenshot settings-branding-saved, apps-branded and login-branded', async ({
		page,
		browser,
	}, testInfo) => {
		await page.goto('/settings/branding')
		await shellSettled(page)
		await chooseFile(page, 'Choose logo', {
			name: 'acme-logo.png',
			mimeType: 'image/png',
			buffer: await demoLogo(),
		})
		await page.getByLabel('Name', { exact: true }).fill(DEMO_BRAND)
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText('Branding saved')).toBeVisible()

		// Loaded afresh, so the shot shows the saved page without the toast; the date renders after hydration.
		await page.goto('/settings/branding')
		await shellSettled(page)
		await noSpinner(page)
		await expect(page.getByText('Last changed by admin@e2e.local')).toBeVisible()
		await waitForHydration(page.locator('time'))
		await imagesLoaded(page.locator('img[src*="/api/branding/logo?v="]'))
		await capture(page, 'settings-branding-saved', testInfo)

		await page.goto('/apps')
		await shellSettled(page)
		await noSpinner(page)
		await expect(page.getByRole('banner').getByRole('link', { name: DEMO_BRAND })).toBeVisible()
		await expect(stubApp(page)).toBeVisible()
		await expect(page.getByText('🤖').first()).toBeVisible()
		await imagesLoaded(page.getByRole('banner').locator('img'))
		await capture(page, 'apps-branded', testInfo)

		// Signed out, as the login shot above: a signed-in visitor is sent away from /login.
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		const login = await context.newPage()
		await login.goto('/login')
		await noSpinner(login)
		await expect(login.getByRole('heading', { name: DEMO_BRAND })).toBeVisible()
		await imagesLoaded(login.locator('img[src*="/api/branding/logo?v="]'))
		await capture(login, 'login-branded', testInfo)
		await context.close()
	})

	test('screenshot admin-sidebar', async ({ page, isMobile }, testInfo) => {
		test.skip(isMobile, 'below md the sidebar gives way to the header drawer (admin-drawer)')
		await openAppManagement(page)
		await capture(page, 'admin-sidebar', testInfo)
	})

	test('screenshot admin-sidebar-collapsed', async ({ page, isMobile }, testInfo) => {
		test.skip(isMobile, 'the sidebar is not part of the mobile layout')
		await openAppManagement(page)
		const sider = page.getByRole('complementary')
		await expect(async () => {
			await page.getByRole('button', { name: 'Collapse sidebar' }).click({ timeout: 1_000 })
			await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible({
				timeout: 1_000,
			})
		}).toPass({ timeout: 30_000 })
		// The open groups' inline lists play their leave motion before the collapsed Menu drops them; locators are strict
		// (Playwright, "Locators: Strictness"), so wait for the one menu first (e2e/admin-nav.spec.ts).
		await expect(sider.getByRole('navigation').getByRole('menu')).toHaveCount(1)
		await sider.getByRole('menuitem', { name: 'Settings' }).click()
		// Until it is aligned, the pop-out waits at `left: -1000vw; top: -1000vh` (@rc-component/trigger useOffsetStyle), which
		// Playwright counts as visible (a non-empty box), so the shot waits for it to intersect the viewport instead
		// (Playwright `toBeInViewport`, "according to the intersection observer API"), then for its fade-in.
		const popOut = page.getByRole('menu').getByRole('link', { name: 'Branding' })
		await expect(popOut).toBeInViewport()
		await fullyOpaque(popOut)
		await capture(page, 'admin-sidebar-collapsed', testInfo)
	})

	test('screenshot admin-drawer', async ({ page, isMobile }, testInfo) => {
		test.skip(!isMobile, 'the drawer is the mobile navigation')
		await openAppManagement(page)
		await openAdminDrawer(page)
		await capture(page, 'admin-drawer', testInfo)
	})
})
