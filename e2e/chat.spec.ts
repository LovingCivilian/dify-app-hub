import { expect, test, type Locator, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'

import { APP_ID, APP_IDS } from './fixtures/constants'

/** The Sender's box by its placeholder: an app's parameter fields above it are textboxes too. */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')

/** A link's input value as `unParseGzipString` reads it: gzip, base64, then URL-encoded. */
const gzipParam = (text: string) => encodeURIComponent(gzipSync(text).toString('base64'))

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
		await expect(senderBox(page)).toBeVisible()
	})

	test('streams an answer and renders Markdown from the stub', async ({ page }, testInfo) => {
		const text = `markdown table ${testInfo.project.name}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText('Quarterly summary')).toBeVisible()
		await expect(page.locator('.ant-bubble table')).toBeVisible()
		await expect(page.getByRole('link', { name: 'previous quarter' })).toHaveAttribute(
			'target',
			'_blank',
		)
	})

	test('a new conversation appears at the top and becomes active', async ({ page, isMobile }) => {
		await senderBox(page).fill('first turn')
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
		await senderBox(page).fill(first)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		await (
			await conversationList(page, isMobile)
		)
			.getByRole('button', { name: 'New conversation' })
			.click()
		await senderBox(page).fill(second)
		await page.keyboard.press('Enter')
		await expect(stop).toBeVisible()
		// Switch back to the first conversation while the second streams (40 chunks at 100 ms).
		await item(await conversationList(page, isMobile), first).click()
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		// The first conversation is idle: no stop control, and a typed message could be sent.
		await expect(stop).toHaveCount(0)
		await senderBox(page).fill('draft')
		await expect(sendButton).toBeEnabled()
		await senderBox(page).fill('')
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

	// beforeEach opened a new conversation, so the welcome panel is showing. The suggested questions are
	// scoped to X's Prompts: the sider also lists earlier conversations named after the first question.
	test('shows the opening statement and the suggested questions before the first message', async ({
		page,
	}) => {
		await expect(page.getByText('Hello from the stub')).toBeVisible()
		await page.locator('.ant-prompts').getByText('What can you do?').click()
		await expect(page.getByText('Echo: What can you do?')).toBeVisible()
		await expect(page.getByText('Hello from the stub')).toHaveCount(0)
	})

	test('offers next-question suggestions after a reply when the app enables them', async ({
		page,
	}, testInfo) => {
		// The stub's agent app turns suggested_questions_after_answer on; the chat app does not.
		const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const first = `hello agent ${run}`
		await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1`)
		// The agent app requires a topic before anything can be sent.
		await page.getByLabel('Topic').fill(`tea ${run}`)
		await senderBox(page).fill(first)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		await page.locator('.ant-prompts').getByText('Why is that?').click()
		await expect(page.getByText('Echo: Why is that?')).toBeVisible()
	})

	// The chat app's welcome panel goes with the first message (the opening-statement test above); the seeded
	// chatflow app has the "always" display mode (auth.setup.ts), so its panel stays.
	test('keeps the welcome panel after the first reply when the app shows it always', async ({
		page,
	}, testInfo) => {
		const first = `hello flow ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await page.goto(`/chat/${APP_IDS['advanced-chat']}?isNewCvst=1`)
		await expect(page.getByText('Hello from the stub advanced-chat')).toBeVisible()
		await senderBox(page).fill(first)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		await expect(page.getByText('Hello from the stub advanced-chat')).toBeVisible()
	})

	test('does not offer next-question suggestions when the app does not enable them', async ({
		page,
	}, testInfo) => {
		const first = `hello chat ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(first)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${first}`)).toBeVisible()
		await expect(page.locator('.ant-prompts')).toHaveCount(0)
	})

	// The stub's agent app has a required "Topic" input, which the chat app does not.
	test('required inputs hold sending back until filled, then stay with the conversation', async ({
		page,
		isMobile,
	}, testInfo) => {
		const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const topic = page.getByLabel('Topic')
		const message = `hello topic ${run}`
		await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1`)
		await expect(topic).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await topic.fill(`tea ${run}`)
		await expect(senderBox(page)).toBeEnabled()
		await senderBox(page).fill(message)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${message}`)).toBeVisible()
		// The conversation has started: its parameter is kept and can no longer be changed.
		await expect(topic).toHaveValue(`tea ${run}`)
		await expect(topic).toBeDisabled()
		// A new conversation asks again (an empty form), and switching back shows the kept value.
		await (
			await conversationList(page, isMobile)
		)
			.getByRole('button', { name: 'New conversation' })
			.click()
		await expect(topic).toHaveValue('')
		await expect(topic).toBeEnabled()
		await expect(senderBox(page)).toBeDisabled()
		await (
			await conversationList(page, isMobile)
		)
			.getByRole('listitem', { name: message, exact: true })
			.click()
		await expect(topic).toHaveValue(`tea ${run}`)
		await expect(senderBox(page)).toBeEnabled()
		// Reopened from Dify (workers: 1: the latest conversation of the agent app is this one).
		await page.goto(`/chat/${APP_IDS['agent-chat']}`)
		await expect(page.getByText(`Echo: ${message}`)).toBeVisible()
		await expect(topic).toHaveValue(`tea ${run}`)
		await expect(topic).toBeDisabled()
	})

	test('a link fills an input once per conversation, then what was typed wins', async ({
		page,
		isMobile,
	}, testInfo) => {
		const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const topic = page.getByLabel('Topic')
		const earlier = `hello link ${run}`
		// A sent conversation to switch to.
		await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1`)
		await topic.fill(`first ${run}`)
		await senderBox(page).fill(earlier)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${earlier}`)).toBeVisible()
		// The link opens a new conversation with its value (gzip, as the link carries it).
		await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1&topic=${gzipParam('from link')}`)
		await expect(topic).toHaveValue('from link')
		await topic.fill('typed over the link')
		await (
			await conversationList(page, isMobile)
		)
			.getByRole('listitem', { name: earlier, exact: true })
			.click()
		await expect(topic).toHaveValue(`first ${run}`)
		await (
			await conversationList(page, isMobile)
		)
			.getByRole('listitem', { name: 'New conversation', exact: true })
			.click()
		// The link is still in the URL, but it was used when this conversation opened.
		await expect(topic).toHaveValue('typed over the link')
	})

	test('a value in a link that is not gzip shows one error', async ({ page }) => {
		await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1&topic=notgzip`)
		await expect(page.getByText(/Failed to decompress parameter topic/)).toHaveCount(1)
		await expect(page.getByLabel('Topic')).toHaveValue('')
	})

	test('a link prefills the sender with its sender_text', async ({ page }) => {
		// The URL's own decoding gives "Tell%20me more"; the link's text is decoded once more (today's rule).
		await page.goto(`/chat/${APP_ID}?isNewCvst=1&sender_text=Tell%2520me%2520more`)
		await expect(senderBox(page)).toHaveValue('Tell me more')
	})

	test('earlier messages load on request and keep the list position', async ({ page }) => {
		// The stub stores 40 earlier turns ("earlier 1" … "earlier 40") before the turn that asked for them.
		// Dify pages oldest first, 20 messages a page: the reopened conversation shows "earlier 22" …
		// "earlier 40" and this turn, the first "Load earlier" adds "earlier 2" … "earlier 21", the second
		// "earlier 1". Exact matches: "Echo: earlier 1" is also a substring of "Echo: earlier 10" … "19".
		await senderBox(page).fill('history40 start')
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
		await senderBox(page).fill(first)
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
