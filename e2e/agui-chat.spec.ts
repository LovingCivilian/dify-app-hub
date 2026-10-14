import { expect, test, type Locator, type Page } from '@playwright/test'

import { AGUI_APP, AGUI_MISSING_APP } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv, stubPort } from './fixtures/env'

/*
 * Part 2 spec §12 (2a "done when") against Task 13's spec-level AG-UI 1.0 stub (ADR-0010; plan call P14). The stub
 * picks its scenario by the last user text; the seed empties the AG-UI apps' conversations on every run, and
 * `workers: 1` keeps one test on the stub at a time, so `/chat/<id>` reopens the conversation the test made last.
 */

/** The Sender's box by its placeholder (`chat.send_placeholder`). */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** X Sender's stop control, named by X's locale (as e2e/chat.spec.ts). */
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop loading' })
/** The answers: Bubble.List's start-placed bubbles (the assistant role), as the Dify specs find them. */
const answers = (page: Page) => page.locator('.ant-bubble-start')
const questions = (page: Page) => page.locator('.ant-bubble-end')
const stubUrl = (path: string) => `http://127.0.0.1:${stubPort}${path}`

const send = async (page: Page, text: string) => {
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
}

/**
 * The conversation list: the sider from md up; below md the list lives in the drawer behind the header's "Menu" button
 * (spec §5.1 reuses the Dify chat's layout; e2e/chat.spec.ts's helper).
 */
async function conversationList(page: Page, isMobile: boolean): Promise<Locator> {
	if (!isMobile) return page.getByRole('complementary')
	await page
		.locator('header.ant-layout-header')
		.getByRole('button', { name: 'Menu', exact: true })
		.click()
	return page.getByRole('dialog', { name: 'Conversations menu' })
}

/** A vertical position on the page, for the arrival order of a turn's parts (spec §5.2). */
const top = async (locator: Locator) => (await locator.boundingBox())!.y

test.describe('the AG-UI chat', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await expect(senderBox(page)).toBeEnabled()
	})

	test('streams reasoning and Markdown text into one answer, signed for the account', async ({
		page,
		request,
	}, testInfo) => {
		await send(page, `hello ${testInfo.project.name}`)
		const answer = answers(page).last()
		await expect(answer.locator('strong', { hasText: 'stub agent' })).toBeVisible()
		// X Think, named as a group by the Reasoning component (message.reasoning_title).
		await expect(answer.getByRole('group', { name: 'Reasoning' })).toBeVisible()
		await expect(stopButton(page)).toHaveCount(0)
		// One X message per turn (spec §5.2).
		await expect(answers(page)).toHaveCount(1)
		// The identity contract end to end (spec §2.3, §10): the stub verified the JWT and kept its claims.
		const ownerId = await withDb(async db => {
			const { rows } = await db.query<{ id: string }>(
				'SELECT id FROM users WHERE lower(email) = lower($1)',
				[e2eEnv.E2E_ADMIN_EMAIL],
			)
			return rows[0]?.id
		})
		const caller = await (await request.get(stubUrl('/agui/_caller'))).json()
		expect(caller).toEqual({ sub: ownerId, auth_source: 'local', roles: ['owner'] })
	})

	test('a tool call shows as a card with its arguments and result, between the texts', async ({
		page,
	}) => {
		await send(page, 'tool')
		const answer = answers(page).last()
		const before = answer.getByText('Let me check the weather.')
		const after = answer.getByText('It is 18 °C and cloudy in Paris.')
		const title = answer.getByText('get_weather', { exact: true })
		await expect(after).toBeVisible()
		await expect(before).toBeVisible()
		await expect(title).toBeVisible()
		// Arrival order (spec §5.2): the text, the call, the text after its result.
		expect(await top(before)).toBeLessThan(await top(title))
		expect(await top(title)).toBeLessThan(await top(after))
		// The card's body opens on a click (ThoughtChain `collapsible`): the arguments and the result as JSON.
		await title.click()
		await expect(answer.getByText('Arguments', { exact: true })).toBeVisible()
		await expect(answer.getByText('Result', { exact: true })).toBeVisible()
		await expect(answer).toContainText('"city": "Paris"')
	})

	test('a run error shows its localised title and the agent’s message', async ({ page }) => {
		await send(page, 'error usage_limit')
		const alert = answers(page).last().getByRole('alert')
		await expect(alert).toContainText('Usage limit reached')
		await expect(alert).toContainText('The stub agent stopped with usage_limit.')
		// An in-stream error ends the run, not the chat: the Sender takes the next message.
		await expect(senderBox(page)).toBeEnabled()
	})

	// Spec §10: each RUN_ERROR code shows its localised title (shared_chat.error.*) and the agent's message.
	test('each run error code shows its title and the agent’s message', async ({ page }) => {
		const titles: Record<string, string> = {
			usage_limit: 'Usage limit reached',
			rate_limited: 'Too many requests, try again shortly',
			busy: 'The agent is busy, try again shortly',
			model_unavailable: 'The model is unavailable',
			agent_error: 'The agent ran into an error',
		}
		for (const [code, title] of Object.entries(titles)) {
			await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
			await expect(senderBox(page)).toBeEnabled()
			await send(page, `error ${code}`)
			const alert = answers(page).last().getByRole('alert')
			await expect(alert).toContainText(title)
			await expect(alert).toContainText(`The stub agent stopped with ${code}.`)
			await expect(senderBox(page)).toBeEnabled()
		}
	})

	test('a run the agent ends at its time limit keeps its text and says so', async ({ page }) => {
		await send(page, 'timeout')
		await expect(
			answers(page).last().getByText('Stopped: time limit', { exact: true }),
		).toBeVisible()
	})

	test('Stop ends the run in place, and the agent stops', async ({ page, request, isMobile }) => {
		await send(page, 'slow')
		const answer = answers(page).last()
		await expect(answer).toContainText('word2')
		if (isMobile) {
			// Next's dev indicator (nextjs-portal, bottom-right, dev only) sits over the Sender's action button at phone
			// width and intercepts the pointer: activate the focused button from the keyboard, as a user could.
			await stopButton(page).focus()
			await page.keyboard.press('Enter')
		} else await stopButton(page).click()
		// Spec §4.5: the hub closes the run as cancelled; the turn finishes where it is.
		await expect(answer.getByText('Stopped', { exact: true })).toBeVisible()
		await expect(stopButton(page)).toHaveCount(0)
		await expect(answers(page)).toHaveCount(1)
		// The agent saw its request closed (the stub's test-only report of the last slow stream).
		await expect
			.poll(async () => (await (await request.get(stubUrl('/agui/_slow'))).json()).closedEarly)
			.toBe(true)
		const { words } = await (await request.get(stubUrl('/agui/_slow'))).json()
		expect(words).toBeLessThan(200)
	})

	test('a reload restores the conversation and its title', async ({ page, isMobile }, testInfo) => {
		const question = `remember me ${testInfo.project.name}`
		await send(page, question)
		await expect(answers(page).last().locator('strong', { hasText: 'stub agent' })).toBeVisible()
		// Without ?isNewCvst the page opens the newest conversation: this one (spec §4.2, newest first).
		await page.goto(`/chat/${AGUI_APP.id}`)
		await expect(questions(page).getByText(question, { exact: true })).toBeVisible()
		await expect(answers(page).last().locator('strong', { hasText: 'stub agent' })).toBeVisible()
		await expect(answers(page).last().getByRole('group', { name: 'Reasoning' })).toBeVisible()
		// The title is the first message (spec §3.1).
		const list = await conversationList(page, isMobile)
		await expect(list.getByRole('listitem', { name: question, exact: true })).toBeVisible()
	})

	test('a conversation can be renamed and deleted from its menu', async ({
		page,
		isMobile,
	}, testInfo) => {
		test.skip(isMobile, 'the item menu is exercised on desktop, as in e2e/chat.spec.ts')
		const run = `${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		const original = `rename me ${run}`
		const renamed = `Renamed ${run}`
		const sider = page.getByRole('complementary')
		const item = (name: string) => sider.getByRole('listitem', { name, exact: true })
		// Each row's menu button is named after its conversation (chat.menu_for).
		const actions = (name: string) =>
			item(name).getByRole('button', { name: `Actions for ${name}`, exact: true })
		await send(page, original)
		await expect(answers(page).last().locator('strong', { hasText: 'stub agent' })).toBeVisible()
		await expect(item(original)).toBeVisible()
		await actions(original).click()
		await page.getByRole('menuitem', { name: 'Rename' }).click()
		const dialog = page.getByRole('dialog', { name: 'Rename' })
		const nameBox = dialog.getByLabel('Enter a conversation name')
		await expect(nameBox).toHaveValue(original)
		await nameBox.fill(renamed)
		await dialog.getByRole('button', { name: 'OK' }).click()
		await expect(dialog).toBeHidden()
		await expect(item(renamed)).toBeVisible()
		// The hub stored the name (a Server Action, spec §4.2): a reload lists it.
		await page.goto(`/chat/${AGUI_APP.id}`)
		await expect(item(renamed)).toBeVisible()
		await actions(renamed).click()
		await page.getByRole('menuitem', { name: 'Delete' }).click()
		const confirm = page.getByRole('dialog', { name: 'Delete this conversation?' })
		await confirm.getByRole('button', { name: 'Delete' }).click()
		await expect(confirm).toBeHidden()
		await expect(item(renamed)).toHaveCount(0)
		// A soft delete (spec §3.4): gone from the user's list for good.
		await page.goto(`/chat/${AGUI_APP.id}`)
		await expect(senderBox(page)).toBeVisible()
		await expect(item(renamed)).toHaveCount(0)
	})

	test('an agent that does not exist answers with a localised error before any stream', async ({
		page,
	}) => {
		await page.goto(`/chat/${AGUI_MISSING_APP.id}?isNewCvst=1`)
		await send(page, 'hello')
		// Spec §4.3 step 4: the agent's 404 is the hub's 502 agent_not_found envelope, worded by Task 16.
		await expect(answers(page).last().getByRole('alert')).toContainText('The agent was not found')
		await expect(senderBox(page)).toBeEnabled()
	})

	test('input the agent refuses before its stream reads as a refused request', async ({ page }) => {
		await send(page, 'invalid please')
		// The agent's 422 is agent_rejected_input (spec §4.3 step 4).
		await expect(answers(page).last().getByRole('alert')).toContainText(
			'The agent refused the request',
		)
	})
})
