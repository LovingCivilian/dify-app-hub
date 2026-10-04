import { expect, test, type Locator, type Page } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

/**
 * The conversation list: the sider from md up; below md the sider is hidden and the list lives in the
 * drawer behind the header's "Menu" button (spec §5.1), which closes again once a conversation is picked.
 */
async function conversationList(page: Page, isMobile: boolean) {
	if (!isMobile) return page.getByRole('complementary')
	await page
		.locator('header.ant-layout-header')
		.getByRole('button', { name: 'Menu', exact: true })
		.click()
	return page.getByRole('dialog', { name: 'Conversations menu' })
}

test.describe('chat', () => {
	// The stub keeps every conversation for the whole run, so /chat/<id> reopens the latest one; each test
	// starts on a new conversation instead (`?isNewCvst=1`, spec §4.4). The tests that reopen their own
	// conversation with /chat/<id> rely on `workers: 1` in playwright.config.ts: no other test touches the
	// stub at the same time, so the latest conversation is theirs.
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
		await expect(page.getByRole('textbox').first()).toBeVisible()
	})

	test('streams an answer and renders Markdown from the stub', async ({ page }, testInfo) => {
		const text = `markdown table ${testInfo.project.name}`
		await page.getByRole('textbox').first().fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText('Quarterly summary')).toBeVisible()
		await expect(page.locator('.ant-bubble table')).toBeVisible()
		await expect(page.getByRole('link', { name: 'previous quarter' })).toHaveAttribute(
			'target',
			'_blank',
		)
	})

	test('a new conversation appears at the top and becomes active', async ({ page, isMobile }) => {
		await page.getByRole('textbox').first().fill('first turn')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: first turn')).toBeVisible()
		await (
			await conversationList(page, isMobile)
		)
			.getByRole('button', { name: 'New conversation' })
			.click()
		await expect(page.getByText('Echo: first turn')).toHaveCount(0)
		const first = (await conversationList(page, isMobile))
			.locator('.ant-conversations-item')
			.first()
		await expect(first).toContainText('New conversation')
		await expect(first).toHaveClass(/ant-conversations-item-active/)
	})

	// Review Focus 4: a reply keeps streaming into the conversation it started in while another one is shown,
	// and only that conversation counts as busy. The stub stores the whole answer when the request arrives,
	// so the history alone could show "0 … 39": the running stream is proven by the Sender's stop control.
	test('switching away during a reply does not lose it', async ({ page, isMobile }, testInfo) => {
		// Names unique per project, repeat and retry: every conversation stays in the stub's list for the run.
		const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const first = `hello one ${run}`
		const second = `slow second ${run}`
		const item = (list: Locator, name: string) => list.getByRole('listitem', { name, exact: true })
		// X Sender's buttons: the stop control is named by X's locale ("Stop loading"), the send button by
		// its icon (ArrowUpOutlined, aria-label "arrow-up").
		const stop = page.getByRole('button', { name: 'Stop loading' })
		const sendButton = page.getByRole('button', { name: 'arrow-up' })
		await page.getByRole('textbox').first().fill(first)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		await (
			await conversationList(page, isMobile)
		)
			.getByRole('button', { name: 'New conversation' })
			.click()
		await page.getByRole('textbox').first().fill(second)
		await page.keyboard.press('Enter')
		await expect(stop).toBeVisible()
		// Switch back to the first conversation while the second streams (40 chunks at 100 ms).
		await item(await conversationList(page, isMobile), first).click()
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		// The first conversation is idle: no stop control, and a typed message could be sent.
		await expect(stop).toHaveCount(0)
		await page.getByRole('textbox').first().fill('draft')
		await expect(sendButton).toBeEnabled()
		await page.getByRole('textbox').first().fill('')
		const list = await conversationList(page, isMobile)
		// One item: the new chat kept its key when the stream named its Dify conversation (no server twin).
		await expect(item(list, second)).toHaveCount(1)
		await item(list, second).click()
		// Back on the second conversation its reply is still running: a stored history never shows that.
		await expect(stop).toBeVisible()
		await expect(page.getByText(/^0 1 2 3/)).toBeVisible()
		// It finishes in its own conversation: the last chunk arrives and the stop control goes.
		await expect(page.locator('.ant-bubble-start').last()).toContainText('37 38 39')
		await expect(stop).toHaveCount(0)
		// No new chat was left behind under the placeholder name.
		await expect(
			(await conversationList(page, isMobile)).getByRole('listitem', {
				name: 'New conversation',
				exact: true,
			}),
		).toHaveCount(0)
	})

	test('earlier messages load on request and keep the list position', async ({ page }) => {
		// The stub stores 40 earlier turns ("earlier 1" … "earlier 40") before the turn that asked for them.
		// Dify pages oldest first, 20 messages a page: the reopened conversation shows "earlier 22" …
		// "earlier 40" and this turn, the first "Load earlier" adds "earlier 2" … "earlier 21", the second
		// "earlier 1". Exact matches: "Echo: earlier 1" is also a substring of "Echo: earlier 10" … "19".
		await page.getByRole('textbox').first().fill('history40 start')
		await page.keyboard.press('Enter')
		await expect(page.getByText('Echo: history40 start', { exact: true })).toBeVisible()
		// Reopen it: /chat/<id> opens the latest conversation.
		await page.goto(`/chat/${APP_ID}`)
		await expect(page.getByText('Echo: history40 start', { exact: true })).toBeVisible()
		await expect(page.getByText('Echo: earlier 22', { exact: true })).toBeVisible()
		await expect(page.getByText('Echo: earlier 21', { exact: true })).toHaveCount(0)
		await expect(page.getByText('earlier 22', { exact: true })).not.toBeInViewport()
		const loadEarlier = page.getByRole('button', { name: 'Load earlier messages' })
		await loadEarlier.click()
		await expect(page.getByText('Echo: earlier 21', { exact: true })).toBeVisible()
		await expect(page.getByText('Echo: earlier 2', { exact: true })).toBeVisible()
		await expect(page.getByText('Echo: earlier 1', { exact: true })).toHaveCount(0)
		// The list keeps its place at the message that was first before the load (Bubble.List scrollTo).
		await expect(page.getByText('earlier 22', { exact: true })).toBeInViewport()
		await loadEarlier.click()
		await expect(page.getByText('Echo: earlier 1', { exact: true })).toBeVisible()
		await expect(loadEarlier).toHaveCount(0)
	})

	test('a failed history load shows an error with a retry, not an empty conversation', async ({
		page,
	}, testInfo) => {
		// The stub fails the first GET /messages of a conversation whose first query contains
		// "brokenhistory" with Dify's documented 404, and answers the next one.
		const first = `brokenhistory ${testInfo.project.name}`
		await page.getByRole('textbox').first().fill(first)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		await page.goto(`/chat/${APP_ID}`)
		const alert = page.getByRole('alert').filter({ hasText: 'Conversation Not Exists.' })
		await expect(alert).toBeVisible()
		await expect(page.getByText(`Echo: ${first}`)).toHaveCount(0)
		await alert.getByRole('button', { name: 'Retry' }).click()
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		await expect(alert).toHaveCount(0)
	})
})
