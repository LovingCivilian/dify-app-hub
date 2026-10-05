import { expect, test, type Page } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

/** The Sender's box by its placeholder: an app's parameter fields above it are textboxes too. */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')

/** The header's drawer trigger (named "Menu", ADR-0014); the header's own copies of the dropdowns are hidden below md. */
const menuButton = (page: Page) =>
	page.locator('header.ant-layout-header').getByRole('button', { name: 'Menu', exact: true })

test.describe('mobile chat', () => {
	test.skip(({ isMobile }) => !isMobile, 'the drawer replaces the sider only below md')

	test.beforeEach(async ({ page }) => {
		// The stub keeps every conversation for the run: each test starts on a new one (spec §4.4).
		await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
		await expect(senderBox(page)).toBeVisible()
	})

	test('the menu button opens the conversation drawer, which switches conversations and holds the account menu', async ({
		page,
	}, testInfo) => {
		const text = `mobile one ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${text}`)).toBeVisible()
		await menuButton(page).click()
		const drawer = page.getByRole('dialog', { name: 'Conversations menu' })
		await expect(drawer).toBeVisible()
		await drawer.getByRole('button', { name: 'New conversation' }).click()
		await expect(drawer).toBeHidden()
		await expect(page.getByText(`Echo: ${text}`)).toHaveCount(0)
		await menuButton(page).click()
		await drawer.getByRole('listitem', { name: text, exact: true }).click()
		await expect(drawer).toBeHidden()
		await expect(page.getByText(`Echo: ${text}`)).toBeVisible()
		// What the header hides below md stays reachable: the account menu opens from the drawer.
		await menuButton(page).click()
		await drawer.getByRole('button', { name: /signed in as/i }).click()
		await expect(page.getByRole('menuitem', { name: /log out/i })).toBeVisible()
	})

	test('the drawer holds the language and theme controls, and a menu opened there is clickable', async ({
		page,
	}) => {
		await menuButton(page).click()
		const drawer = page.getByRole('dialog', { name: 'Conversations menu' })
		await expect(drawer.getByRole('button', { name: 'Theme' })).toBeVisible()
		await expect(drawer.getByRole('button', { name: /signed in as/i })).toBeVisible()
		await drawer.getByRole('button', { name: 'Language' }).click()
		// A click, not only visibility: it proves the dropdown is not covered by the drawer.
		await page.getByRole('menuitem', { name: 'العربية' }).click()
		await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
	})

	// Review Focus 4 on mobile: a reply keeps streaming into the conversation it started in while the drawer
	// switches to another one, and only that conversation counts as busy (mirrors the desktop test in chat.spec.ts).
	test('switching away through the drawer during a reply does not lose it', async ({
		page,
	}, testInfo) => {
		const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const first = `mobile hello ${run}`
		const second = `mobile slow second ${run}`
		const drawer = page.getByRole('dialog', { name: 'Conversations menu' })
		const item = (name: string) => drawer.getByRole('listitem', { name, exact: true })
		const stop = page.getByRole('button', { name: 'Stop loading' })
		const sendButton = page.getByRole('button', { name: 'arrow-up' })
		await senderBox(page).fill(first)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		await menuButton(page).click()
		await drawer.getByRole('button', { name: 'New conversation' }).click()
		await senderBox(page).fill(second)
		await page.keyboard.press('Enter')
		await expect(stop).toBeVisible()
		// Switch back to the first conversation while the second streams (40 chunks at 100 ms).
		await menuButton(page).click()
		await item(first).click()
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		// The first conversation is idle: no stop control, and a typed message could be sent.
		await expect(stop).toHaveCount(0)
		await senderBox(page).fill('draft')
		await expect(sendButton).toBeEnabled()
		await senderBox(page).fill('')
		await menuButton(page).click()
		// One item: the new chat kept its key when the stream named its Dify conversation (no server twin).
		await expect(item(second)).toHaveCount(1)
		await item(second).click()
		// Back on the second conversation its reply is still running: a stored history never shows that.
		await expect(stop).toBeVisible()
		await expect(page.getByText(/^0 1 2 3/)).toBeVisible()
		await expect(page.locator('.ant-bubble-start').last()).toContainText('37 38 39')
		await expect(stop).toHaveCount(0)
	})

	test('the drawer closes when the viewport grows to md, where the sider takes over', async ({
		page,
	}) => {
		await menuButton(page).click()
		const drawer = page.getByRole('dialog', { name: 'Conversations menu' })
		await expect(drawer).toBeVisible()
		await page.setViewportSize({ width: 1024, height: 800 })
		await expect(drawer).toBeHidden()
		await expect(page.getByRole('complementary')).toBeVisible()
	})
})
