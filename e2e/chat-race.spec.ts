import { expect, test, type Page, type Request, type Response } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

const pathOf = (url: string) => new URL(url).pathname
/** GET /api/dify/<app>/messages: a conversation's history (Dify's GET /messages, the conversation in the query). */
const isHistory = (response: Response) =>
	response.request().method() === 'GET' && pathOf(response.url()).endsWith('/messages')
/** POST …/chat-messages: a send. */
const isSend = (request: Request) =>
	request.method() === 'POST' && pathOf(request.url()).endsWith('/chat-messages')

// The late-history race: a message sent while a reopened conversation's history is loading used to be
// wiped when the history arrived. The stub delays /messages by 1.5 s for conversations whose first
// query contains "slowhistory"; the send is queued by useXChat (queueRequest) until the history lands.
test('a message sent while the history loads is kept next to the history', async ({
	page,
}, testInfo) => {
	const first = `slowhistory ${testInfo.project.name}`
	// A new conversation, so the marker is its first query (the stub's state lasts for the whole run).
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	await page.getByRole('textbox').first().fill(first)
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${first}`, { exact: true })).toBeVisible()

	// Reopen it and send at once, while its history is still on the way. /chat/<id> opens the latest
	// conversation, which is this one because `workers: 1` (playwright.config.ts) runs one test at a time.
	// The order of the two network events tells the queue apart from a send that races the history: both
	// waits start before the actions that cause them (Playwright docs, "Network events":
	// https://playwright.dev/docs/network#network-events, page.waitForResponse / page.waitForRequest).
	const order: string[] = []
	const historyArrived = page.waitForResponse(isHistory).then(() => order.push('history'))
	await page.goto(`/chat/${APP_ID}`)
	await page.getByRole('textbox').first().fill('sent at once')
	const sent = page.waitForRequest(isSend).then(() => order.push('send'))
	await page.keyboard.press('Enter')
	// The send happened during the load (or this test would pass without the race).
	await expect(page.getByText(`Echo: ${first}`, { exact: true })).toHaveCount(0)
	await Promise.all([historyArrived, sent])
	// The queued send left only after the history had arrived.
	expect(order).toEqual(['history', 'send'])
	await expect(page.getByText(`Echo: ${first}`, { exact: true })).toBeVisible()
	await expect(page.getByText('Echo: sent at once', { exact: true })).toBeVisible()
	// The user's bubble (placement end): the streamed answer holds the same words in a chunk of its own.
	await expect(
		page.locator('.ant-bubble-end').getByText('sent at once', { exact: true }),
	).toBeVisible()
})

/** The conversation list: the sider from md up, the header's drawer below it (as in chat.spec.ts). */
async function conversationList(page: Page, isMobile: boolean) {
	if (!isMobile) return page.getByRole('complementary')
	await page
		.locator('header.ant-layout-header')
		.getByRole('button', { name: 'Menu', exact: true })
		.click()
	return page.getByRole('dialog', { name: 'Conversations menu' })
}

// The SDK keeps a queued send per conversation and flushes it only for the conversation on screen
// (use-x-chat: queueRequest), so switching away before the history lands would drop the message silently.
// Until the queued reply has started, the other conversations and the new-chat button are disabled and the
// list says why (ADR-0017 note of 2026-10-05, final review).
test('while a send waits for the history, the conversation cannot be switched and the reply arrives', async ({
	page,
	isMobile,
}, testInfo) => {
	const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
	const other = `queue other ${run}`
	const first = `slowhistory guard ${run}`
	const hint = 'Your message will be sent once this conversation has loaded.'
	// Another conversation to switch to, then the slow one, which is the latest (workers: 1).
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	await page.getByRole('textbox').first().fill(other)
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${other}`, { exact: true })).toBeVisible()
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	await page.getByRole('textbox').first().fill(first)
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${first}`, { exact: true })).toBeVisible()

	// Reopen it and send while its history (1.5 s) is on the way, then try to leave.
	await page.goto(`/chat/${APP_ID}`)
	await page.getByRole('textbox').first().fill('queued while loading')
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${first}`, { exact: true })).toHaveCount(0)
	const list = await conversationList(page, isMobile)
	const item = (name: string) => list.getByRole('listitem', { name, exact: true })
	await expect(list.getByText(hint, { exact: true })).toBeVisible()
	await expect(item(other)).toHaveClass(/ant-conversations-item-disabled/)
	await expect(list.getByRole('button', { name: 'New conversation' })).toHaveClass(
		/ant-conversations-creation-disabled/,
	)
	await item(other).click()
	// The click changed nothing: the slow conversation stays active, its history and the reply arrive.
	await expect(page.getByText('Echo: queued while loading', { exact: true })).toBeVisible()
	await expect(page.getByText(`Echo: ${first}`, { exact: true })).toBeVisible()
	await expect(page.getByText(`Echo: ${other}`, { exact: true })).toHaveCount(0)
	await expect(list.locator('.ant-conversations-item-active')).toHaveAttribute('title', first)
	// Once the reply has started the guard is gone and switching works again.
	await expect(list.getByText(hint, { exact: true })).toHaveCount(0)
	await item(other).click()
	await expect(page.getByText(`Echo: ${other}`, { exact: true })).toBeVisible()
})
