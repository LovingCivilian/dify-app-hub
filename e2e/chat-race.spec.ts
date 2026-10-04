import { expect, test, type Request, type Response } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

const pathOf = (url: string) => new URL(url).pathname
/** GET …/conversation/<id>/messages: a conversation's history (the proxy's route for Dify's GET /messages). */
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
