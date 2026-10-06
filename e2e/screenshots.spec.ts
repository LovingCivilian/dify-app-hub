import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { APP_ID, APP_IDS } from './fixtures/constants'

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
		},
	},
	admin: {
		path: '/app-management',
		ready: async page => {
			await noSpinner(page)
			await expect(header(page)).toBeVisible()
			await expect(stubApp(page)).toBeVisible()
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
 * (the `dark` class on `<body>`), so dark projects wait for that class; `animations: 'disabled'`
 * then fast-forwards the antd colour transitions that hydration starts
 * (https://playwright.dev/docs/api/class-page#page-screenshot, option `animations`).
 */
async function capture(page: Page, name: string, testInfo: TestInfo) {
	if (testInfo.project.use.colorScheme === 'dark') {
		await expect(page.locator('body')).toHaveClass(/\bdark\b/)
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

test('screenshot annotations-drawer', async ({ page }, testInfo) => {
	await page.goto('/app-management')
	await page
		.locator(`tr[data-row-key="${APP_IDS['advanced-chat']}"]`)
		.getByRole('button', { name: 'More actions' })
		.click()
	await page.getByRole('menuitem', { name: 'Annotations' }).click()
	await expect(page.getByRole('dialog').getByRole('table')).toBeVisible()
	await noSpinner(page)
	await capture(page, 'annotations-drawer', testInfo)
})

test('screenshot user-drawer', async ({ page }, testInfo) => {
	await page.goto('/user-management')
	await page.getByRole('button', { name: 'Add user' }).click()
	await expect(page.getByRole('dialog').getByLabel('Name')).toBeVisible()
	await capture(page, 'user-drawer', testInfo)
})
