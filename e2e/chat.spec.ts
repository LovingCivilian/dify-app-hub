import { expect, test, type Locator, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'

import { APP_ID, APP_IDS } from './fixtures/constants'
import { baseURL } from './fixtures/env'

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
		// Not named with "topic": its row's menu button ("Actions for …") would also match getByLabel('Topic'),
		// here and in every later test on the agent app (the stub lists the conversation for the whole run).
		const message = `hello params ${run}`
		// While the parameters are missing the Sender's placeholder says so (chat.inputs_required).
		const waitingBox = page.getByPlaceholder('Fill in the conversation parameters first.')
		await page.goto(`/chat/${APP_IDS['agent-chat']}?isNewCvst=1`)
		await expect(topic).toBeVisible()
		await expect(waitingBox).toBeDisabled()
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
		await expect(waitingBox).toBeDisabled()
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

	// The stub's `cite` scenario ends with two retriever resources, streamed without an `id` as Dify's are.
	// X Sources lists their titles; the excerpt of the one picked shows below the list.
	test('citations are listed under the answer', async ({ page }, testInfo) => {
		const text = `cite the handbook ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
		const first = page.getByText('#1 handbook-1.md', { exact: true })
		const second = page.getByText('#2 handbook-2.md', { exact: true })
		await expect(first).toBeHidden()
		await page.getByText('Citations', { exact: true }).click()
		await expect(first).toBeVisible()
		await expect(second).toBeVisible()
		// Opening the list picks nothing.
		await expect(page.getByText('Tea is brewed at 80 °C.')).toHaveCount(0)
		await second.click()
		await expect(page.getByText('Steep for three minutes.', { exact: true })).toBeVisible()
		await expect(page.getByText('Retrieval score: 0.70', { exact: true })).toBeVisible()
		await expect(page.getByText('Tea is brewed at 80 °C.')).toHaveCount(0)
		await first.click()
		await expect(page.getByText('Tea is brewed at 80 °C.', { exact: true })).toBeVisible()
		await expect(page.getByText('Retrieval score: 0.80', { exact: true })).toBeVisible()
		await expect(page.getByText('Steep for three minutes.')).toHaveCount(0)
	})

	// Spec §4.7: regenerate is a new turn with the question (not onReload), so live and history views match.
	test('regenerate re-sends the question as a new turn and copy puts the answer on the clipboard', async ({
		page,
		context,
	}, testInfo) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])
		const text = `again please ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const answers = page.getByText(`Echo: ${text}`, { exact: true })
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(answers).toHaveCount(1)
		await page
			.locator('.ant-bubble-start')
			.last()
			.getByRole('button', { name: 'Regenerate response' })
			.click()
		await expect(answers).toHaveCount(2)
		await expect(page.locator('.ant-bubble-end').filter({ hasText: text })).toHaveCount(2)
		// antd's Typography copy button inside X's Actions.Copy, named by antd's locale.
		await page.locator('.ant-bubble-start').last().getByRole('button', { name: 'Copy' }).click()
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe(`Echo: ${text}`)
	})

	// PRs #7/#8 (spec §10): the answer's creation time from the stream, in the active language.
	test('an answer shows when it was created, in the active language', async ({
		page,
	}, testInfo) => {
		const text = `what time ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
		// The time alone, titled "Sent at" (message.sent_at); en-US: "1/15/2026, 9:05:00 AM".
		await expect(page.locator('.ant-bubble-start').last().getByTitle('Sent at')).toHaveText(
			/^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2}\s[AP]M$/,
		)
		// Reopened in Arabic (the UI language cookie the root layout reads; workers: 1, so the latest conversation
		// is this one): Arabic-Indic digits (ADR-0005).
		await page.context().addCookies([{ name: 'i18next', value: 'ar', url: baseURL }])
		await page.goto(`/chat/${APP_ID}`)
		await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
		await expect(page.locator('.ant-bubble-start').last().getByTitle('وقت الإرسال')).toHaveText(
			/[٠-٩]{4}/,
		)
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

	// Spec §4.4 / §5.2: the item menu renames on Dify and deletes there, both through a confirm modal; the
	// stub keeps the changes, so the reloaded list proves the server side. Desktop only: the drawer has its own spec.
	test('a conversation can be renamed and deleted from its menu', async ({
		page,
		isMobile,
	}, testInfo) => {
		test.skip(isMobile, 'the item menu is exercised on desktop; mobile uses the drawer spec')
		const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const original = `rename me ${run}`
		const renamed = `Renamed ${run}`
		const sider = page.getByRole('complementary')
		const item = (name: string) => sider.getByRole('listitem', { name, exact: true })
		// Each row's menu button is named after its conversation (chat.menu_for).
		const actions = (name: string) =>
			item(name).getByRole('button', { name: `Actions for ${name}`, exact: true })
		await senderBox(page).fill(original)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${original}`)).toBeVisible()
		await expect(item(original)).toBeVisible()
		// Rename: a confirm modal with a Form; an empty name is refused where it is typed.
		await actions(original).click()
		await page.getByRole('menuitem', { name: 'Rename' }).click()
		const dialog = page.getByRole('dialog', { name: 'Rename' })
		const nameBox = dialog.getByLabel('Enter a conversation name')
		await expect(nameBox).toHaveValue(original)
		await nameBox.fill('')
		await dialog.getByRole('button', { name: 'OK' }).click()
		await expect(dialog.getByText('Enter a conversation name', { exact: true })).toBeVisible()
		await expect(dialog).toBeVisible()
		await nameBox.fill(renamed)
		await dialog.getByRole('button', { name: 'OK' }).click()
		await expect(dialog).toBeHidden()
		await expect(item(renamed)).toBeVisible()
		await expect(item(original)).toHaveCount(0)
		// Dify has the new name: a reload lists it.
		await page.goto(`/chat/${APP_ID}`)
		await expect(item(renamed)).toBeVisible()
		// Delete: the active conversation goes, another one takes its place, and the server forgot it.
		await actions(renamed).click()
		await page.getByRole('menuitem', { name: 'Delete' }).click()
		const confirm = page.getByRole('dialog', { name: 'Delete this conversation?' })
		await confirm.getByRole('button', { name: 'Cancel' }).click()
		await expect(confirm).toBeHidden()
		await expect(item(renamed)).toBeVisible()
		await actions(renamed).click()
		await page.getByRole('menuitem', { name: 'Delete' }).click()
		await confirm.getByRole('button', { name: 'Delete' }).click()
		await expect(confirm).toBeHidden()
		await expect(item(renamed)).toHaveCount(0)
		await expect(page.getByText(`Echo: ${original}`)).toHaveCount(0)
		// The page is still usable: some conversation is active and the Sender accepts text.
		await expect(sider.locator('.ant-conversations-item-active')).toHaveCount(1)
		await expect(senderBox(page)).toBeEnabled()
		await page.goto(`/chat/${APP_ID}`)
		await expect(senderBox(page)).toBeVisible()
		await expect(item(renamed)).toHaveCount(0)
	})

	// A new chat has no Dify id until its first reply: it cannot be renamed there, only discarded.
	test('a new chat that was not sent offers delete only', async ({ page, isMobile }) => {
		test.skip(isMobile, 'the item menu is exercised on desktop; mobile uses the drawer spec')
		const sider = page.getByRole('complementary')
		const active = sider.locator('.ant-conversations-item-active')
		await expect(active).toContainText('New conversation')
		await active.getByRole('button', { name: 'Actions for New conversation', exact: true }).click()
		await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
		await expect(page.getByRole('menuitem', { name: 'Rename' })).toHaveCount(0)
	})

	// Spec §5.1: collapsed, the sider keeps the app icon, a new-chat button and the list behind a Popover.
	test('the sider collapses to a rail with the list in a popover, and expands again', async ({
		page,
		isMobile,
	}, testInfo) => {
		test.skip(isMobile, 'no sider below md')
		const text = `collapse me ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const sider = page.getByRole('complementary')
		const width = async () => (await sider.boundingBox())?.width ?? 0
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${text}`)).toBeVisible()
		await expect(sider.getByRole('listitem', { name: text, exact: true })).toBeVisible()
		const expanded = await width()
		// The toggle is a disclosure of the sider (aria-expanded, aria-controls naming the sider's id).
		const siderId = await sider.getAttribute('id')
		expect(siderId).toBeTruthy()
		const collapse = sider.getByRole('button', { name: 'Collapse sidebar' })
		await expect(collapse).toHaveAttribute('aria-expanded', 'true')
		await expect(collapse).toHaveAttribute('aria-controls', siderId!)
		await collapse.click()
		await expect(sider.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
		await expect(sider.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
			'aria-expanded',
			'false',
		)
		// The list and the app info are gone from the sider; only the rail's controls remain.
		await expect(sider.locator('.ant-conversations')).toHaveCount(0)
		await expect(sider.getByText('Stub app', { exact: true })).toHaveCount(0)
		await expect.poll(width).toBeLessThan(expanded)
		await expect(sider.getByRole('button', { name: 'New conversation' })).toBeVisible()
		// The list opens in a popover (click-triggered, ADR-0014) and picking an item closes it again.
		await sider.getByRole('button', { name: 'Conversations', exact: true }).click()
		const popover = page.locator('.ant-popover')
		await expect(popover.getByRole('listitem', { name: text, exact: true })).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(popover.getByRole('listitem', { name: text, exact: true })).toBeHidden()
		await sider.getByRole('button', { name: 'New conversation' }).click()
		await expect(page.getByText(`Echo: ${text}`)).toHaveCount(0)
		await sider.getByRole('button', { name: 'Conversations', exact: true }).click()
		await popover.getByRole('listitem', { name: text, exact: true }).click()
		await expect(page.getByText(`Echo: ${text}`)).toBeVisible()
		await expect(popover.getByRole('listitem', { name: text, exact: true })).toBeHidden()
		// Expanding restores the list and the app info.
		await sider.getByRole('button', { name: 'Expand sidebar' }).click()
		await expect(sider.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
		await expect(sider.getByRole('listitem', { name: text, exact: true })).toBeVisible()
		await expect(sider.getByText('Stub app', { exact: true })).toBeVisible()
		await expect.poll(width).toBe(expanded)
	})
})
