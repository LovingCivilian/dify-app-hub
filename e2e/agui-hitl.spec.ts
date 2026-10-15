import { expect, test, type Locator, type Page } from '@playwright/test'

import { AGUI_APP } from './fixtures/constants'

/*
 * Part 2 spec §6 and §12 (2b "done when") against Task 16's human-in-the-loop scenarios of the stub AG-UI producer
 * (ADR-0010; plan call P18): approvals, the hub's ask_user questions, the other interrupts, the plan panel and activity
 * cards, and the composer blocked while anything is open (decision 50). The seed turns AGUI_APP's `askUser` on, so its
 * runs advertise ask_user. Each prompt is a stub keyword (Task 16's table); `workers: 1` keeps one test on the stub at
 * a time, so `/chat/<id>` reopens the conversation the test made last (e2e/agui-chat.spec.ts).
 */

/** The Sender's box by its placeholder (`chat.send_placeholder`), which it keeps while disabled (Task 15). */
const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** X Sender's stop control, named by X's locale (as e2e/agui-chat.spec.ts). */
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop loading' })
/** The answers: Bubble.List's start-placed bubbles (the assistant role), as the 2a specs find them. */
const answers = (page: Page) => page.locator('.ant-bubble-start')
/** Plan call P15 (#69): the visible line above the Sender while an answer is pending. */
const hint = (page: Page) => page.getByText('Answer the agent above to continue.')
/** The free answer of the ask_user card (Task 12, `shared_chat.ask_user.custom_placeholder`). */
const freeAnswer = (page: Page) => page.getByPlaceholder('Something else')
/**
 * The ask_user card's pager (`‹ 1 of 2 ›`), a group named by `shared_chat.ask_user.progress` ("Question 1 of 2"), so
 * its name says which question is on show.
 */
const pager = (page: Page, name: string | RegExp) => page.getByRole('group', { name })
/** An option of the ask_user card: a button named by the option's text (its digit badge is hidden from the name). */
const option = (page: Page, name: string) => page.getByRole('button', { name, exact: true })
const RUNS_PATH = /\/api\/apps\/[^/]+\/runs$/

const send = async (page: Page, text: string) => {
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
}

/** A vertical position on the page, for where a card sits (spec §6.2: above the composer). */
const top = async (locator: Locator) => (await locator.boundingBox())!.y

/**
 * Activates a button once it is enabled (the cards' buttons are disabled while a request runs: Task 11's `disabled`).
 * At phone width Next's dev indicator (bottom-right, dev only) can sit over the controls near the Sender; ADR-0028's
 * note and ADR-0010's "Patterns to avoid" rule out moving it for tests, so there the button is pressed from the
 * keyboard, which a real user can do, as 2a's Stop test does (Locator.press focuses the element, then presses the key).
 */
const activate = async (button: Locator, isMobile: boolean) => {
	await expect(button).toBeEnabled()
	if (isMobile) await button.press('Enter')
	else await button.click()
}

/** The POST /runs requests the page makes from now on (spec §4.2), to count what the answers send. */
const runRequests = (page: Page) => {
	const urls: string[] = []
	page.on('request', request => {
		if (request.method() === 'POST' && RUNS_PATH.test(new URL(request.url()).pathname))
			urls.push(request.url())
	})
	return urls
}

/** Opens each tool card's collapsible body by its title (ThoughtChain `collapsible`, as in e2e/agui-chat.spec.ts). */
const openToolCards = async (answer: Locator, name: string) => {
	for (const title of await answer.getByText(name, { exact: true }).all()) await title.click()
}

test.describe('human in the loop in the AG-UI chat', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await expect(senderBox(page)).toBeEnabled()
	})

	test('an approval blocks the composer; Approve runs the call and the agent goes on in the same turn', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'gated')
		const answer = answers(page).last()
		// Spec §6.1: Approve and Reject on the gated call's card, with the interrupt's message.
		await expect(answer.getByText('Approve delete_file({"path": "report.pdf"})?')).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		await activate(answer.getByRole('button', { name: 'Approve' }), isMobile)
		await expect(answer.getByText('Done: report.pdf deleted.')).toBeVisible()
		// The resumed run continues the same turn (spec §6.1, onReload), and its result lands on the gated call's card.
		await expect(answers(page)).toHaveCount(1)
		await openToolCards(answer, 'delete_file')
		await expect(answer).toContainText('Deleted report.pdf.')
		await expect(answer.getByRole('button', { name: 'Approve' })).toHaveCount(0)
		await expect(senderBox(page)).toBeEnabled()
		await expect(hint(page)).toHaveCount(0)
	})

	test('Reject sends the schema’s reason, which the agent returns as the call’s result', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'gated')
		const answer = answers(page).last()
		await activate(answer.getByRole('button', { name: 'Reject' }), isMobile)
		await expect(answer.getByText('Done: report.pdf kept.')).toBeVisible()
		await openToolCards(answer, 'delete_file')
		// Plan call P5: the schema declares a string `reason`, so Reject adds REJECTED_REASON.
		await expect(answer).toContainText('Not deleted: Rejected by the user')
		await expect(senderBox(page)).toBeEnabled()
	})

	test('two approvals go back together, in one request, once both have a decision', async ({
		page,
		isMobile,
	}) => {
		const runs = runRequests(page)
		await send(page, 'double')
		const answer = answers(page).last()
		const approve = answer.getByRole('button', { name: 'Approve' })
		await expect(approve).toHaveCount(2)
		await expect(stopButton(page)).toHaveCount(0)
		expect(runs).toHaveLength(1)
		// Decision 62's third answer: the first decision is kept in the browser, and nothing is sent yet.
		await activate(approve.first(), isMobile)
		await expect(approve).toHaveCount(1)
		await expect(hint(page)).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		expect(runs).toHaveLength(1)
		await activate(answer.getByRole('button', { name: 'Reject' }), isMobile)
		await expect(answer.getByText('Done: report.pdf deleted, notes.txt kept.')).toBeVisible()
		// Exactly one request carried both answers (a request after the first decision would make it three).
		expect(runs).toHaveLength(2)
		await openToolCards(answer, 'delete_file')
		await expect(answer).toContainText('Deleted report.pdf.')
		await expect(answer).toContainText('Not deleted: Rejected by the user')
		await expect(senderBox(page)).toBeEnabled()
	})

	test('an answer the agent refuses before its stream keeps the approval open, and a retry goes through', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'fragile')
		const answer = answers(page).last()
		const approve = answer.getByRole('button', { name: 'Approve' })
		await activate(approve, isMobile)
		// Decision 62's first answer (#67): the refusal shows under the card, which stays answerable.
		const alert = answer.getByRole('alert')
		await expect(alert).toContainText('The agent refused the request')
		await expect(approve).toBeEnabled()
		expect(await top(alert)).toBeGreaterThan(await top(approve))
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		await activate(approve, isMobile)
		await expect(answer.getByText('Done: report.pdf deleted.')).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('the ask_user card above the composer takes an option and a free answer', async ({
		page,
	}) => {
		await send(page, 'question')
		const progress = pager(page, 'Question 1 of 2')
		await expect(progress).toBeVisible()
		await expect(progress).toContainText('1 of 2')
		expect(await top(progress)).toBeLessThan(await top(senderBox(page)))
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		// Spec §6.2: the options as buttons, one click picks.
		await page.getByText('Paris').click()
		await expect(pager(page, 'Question 2 of 2')).toBeVisible()
		await freeAnswer(page).fill('May')
		await freeAnswer(page).press('Enter')
		// The template's Q/A transcript reached the agent as the call's tool message (Task 16 echoes it, lines as " / ").
		await expect(
			answers(page)
				.last()
				.getByText('Got your answers: Q: Which city? / A: Paris / Q: Which month? / A: May'),
		).toBeVisible()
		await expect(pager(page, /^Question \d+ of \d+$/)).toHaveCount(0)
		await expect(senderBox(page)).toBeEnabled()
		await expect(hint(page)).toHaveCount(0)
	})

	test('Skip skips one question, and Dismiss skips the rest', async ({ page, isMobile }) => {
		await send(page, 'question')
		await activate(page.getByRole('button', { name: 'Skip' }), isMobile)
		await expect(pager(page, 'Question 2 of 2')).toBeVisible()
		await freeAnswer(page).fill('May')
		await freeAnswer(page).press('Enter')
		await expect(
			answers(page)
				.last()
				.getByText('Got your answers: Q: Which city? / A: (skipped) / Q: Which month? / A: May'),
		).toBeVisible()

		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await send(page, 'question')
		await activate(page.getByRole('button', { name: 'Dismiss questions' }), isMobile)
		await expect(
			answers(page)
				.last()
				.getByText(
					'Got your answers: Q: Which city? / A: (skipped) / Q: Which month? / A: (skipped)',
				),
		).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('a digit key picks that option', async ({ page }) => {
		await send(page, 'question')
		await expect(pager(page, 'Question 1 of 2')).toBeVisible()
		// The template's keyboard rule (question-prompt.tsx): a digit picks that option from anywhere in the question;
		// Locator.press focuses Skip first, and the key reaches the question's handler.
		await page.getByRole('button', { name: 'Skip' }).press('2')
		await expect(pager(page, 'Question 2 of 2')).toBeVisible()
		await freeAnswer(page).fill('June')
		await freeAnswer(page).press('Enter')
		await expect(
			answers(page)
				.last()
				.getByText('Got your answers: Q: Which city? / A: Rome / Q: Which month? / A: June'),
		).toBeVisible()
	})

	test('‹ goes back to change an answer, and the card moves on to the first question without one', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'question')
		await option(page, 'Paris').click()
		await expect(pager(page, 'Question 2 of 2')).toBeVisible()
		// › reaches only a question that has an answer; Skip is how to pass one without.
		await expect(page.getByRole('button', { name: 'Next question' })).toBeDisabled()
		await activate(page.getByRole('button', { name: 'Previous question' }), isMobile)
		await expect(pager(page, 'Question 1 of 2')).toBeVisible()
		// The answer given there shows as chosen (✓; `aria-current`) and has the focus.
		await expect(option(page, 'Paris')).toHaveAttribute('aria-current', 'true')
		await expect(option(page, 'Paris')).toBeFocused()
		await expect(option(page, 'Rome')).not.toHaveAttribute('aria-current')
		await expect(page.getByRole('button', { name: 'Previous question' })).toBeDisabled()
		await expect(page.getByRole('button', { name: 'Next question' })).toBeEnabled()
		// Another option replaces the answer, and the card goes on to the question without one.
		await option(page, 'Rome').click()
		await expect(pager(page, 'Question 2 of 2')).toBeVisible()
		await expect(freeAnswer(page)).toHaveValue('')
		await freeAnswer(page).fill('May')
		await freeAnswer(page).press('Enter')
		await expect(
			answers(page)
				.last()
				.getByText('Got your answers: Q: Which city? / A: Rome / Q: Which month? / A: May'),
		).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('the arrow keys move between the options, and Enter picks one', async ({ page }) => {
		await send(page, 'question')
		await expect(pager(page, 'Question 1 of 2')).toBeVisible()
		// The question opens with its first option focused, so the keys work at once.
		await expect(option(page, 'Paris')).toBeFocused()
		// One highlighted row: a moving mouse takes the focus along, and the keys go on from there.
		await option(page, 'Rome').hover()
		await expect(option(page, 'Rome')).toBeFocused()
		await page.keyboard.press('ArrowUp')
		await expect(option(page, 'Paris')).toBeFocused()
		await page.keyboard.press('ArrowDown')
		await expect(option(page, 'Rome')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(pager(page, 'Question 2 of 2')).toBeVisible()
		await page.getByRole('button', { name: 'Skip' }).press('Enter')
		await expect(
			answers(page)
				.last()
				.getByText('Got your answers: Q: Which city? / A: Rome / Q: Which month? / A: (skipped)'),
		).toBeVisible()
	})

	test('an invalid question offers Dismiss, which the hub answers with an error', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'badquestion')
		const answer = answers(page).last()
		// Plan call P3: the call's arguments fail the schema; its card in the turn says so.
		await expect(answer.getByText('The agent asked an invalid question')).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await activate(page.getByRole('button', { name: 'Dismiss questions' }), isMobile)
		await expect(answer.getByText('The question was dismissed.')).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('an input_required interrupt is a form: Submit sends its values, Cancel cancels it', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'form')
		let answer = answers(page).last()
		// Spec §6.3: a Card titled from the reason (Task 13 localises the core ones), with the interrupt's message.
		await expect(answer.getByText('The agent needs more information')).toBeVisible()
		await expect(answer.getByText('Please provide the quarterly filing details.')).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		// Spec §6.3: enum → Radio.Group, integer and number → InputNumber, each labelled by its property.
		await answer.getByRole('radio', { name: 'Q2' }).check()
		await answer.getByLabel('year').fill('2026')
		await answer.getByLabel('revenue').fill('1250')
		await activate(answer.getByRole('button', { name: 'Submit' }), isMobile)
		await expect(
			answer.getByText('Filed: {"quarter":"Q2","year":2026,"revenue":1250}'),
		).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()

		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await send(page, 'form')
		answer = answers(page).last()
		await activate(answer.getByRole('button', { name: 'Cancel' }), isMobile)
		await expect(answer.getByText('The form was cancelled.')).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('a confirmation without a schema answers Yes or No as a boolean', async ({
		page,
		isMobile,
	}) => {
		for (const [button, value] of [
			['Yes', 'true'],
			['No', 'false'],
		]) {
			await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
			await send(page, 'confirm')
			const answer = answers(page).last()
			await expect(answer.getByText('The agent asks you to confirm')).toBeVisible()
			await expect(answer.getByText('Archive the old reports?')).toBeVisible()
			// Plan call P6: a confirmation without a responseSchema sends a bare boolean.
			await activate(answer.getByRole('button', { name: button, exact: true }), isMobile)
			await expect(answer.getByText(`Confirmed: ${value}`)).toBeVisible()
			await expect(senderBox(page)).toBeEnabled()
		}
	})

	test('an expired interrupt offers only Dismiss, which cancels it', async ({ page, isMobile }) => {
		await send(page, 'expired')
		const answer = answers(page).last()
		await expect(answer.getByText('Expired', { exact: true })).toBeVisible()
		await expect(answer.getByRole('button', { name: 'Submit' })).toHaveCount(0)
		await expect(senderBox(page)).toBeDisabled()
		await activate(answer.getByRole('button', { name: 'Dismiss', exact: true }), isMobile)
		await expect(answer.getByText('The request expired.')).toBeVisible()
		await expect(senderBox(page)).toBeEnabled()
	})

	test('the plan shows above the composer and closes once every step is done', async ({ page }) => {
		await send(page, 'plan')
		await expect(
			answers(page).last().getByText('I made a plan and finished its first step.'),
		).toBeVisible()
		// Spec §6.4: one Collapse panel headed "Plan 1/3" (antd's header is a button with aria-expanded).
		const panel = page.getByRole('button', { name: 'Plan 1/3' })
		await expect(panel).toHaveAttribute('aria-expanded', 'true')
		expect(await top(panel)).toBeLessThan(await top(senderBox(page)))
		for (const step of ['Gather the sources', 'Draft the summary', 'Review the draft'])
			await expect(page.getByText(step, { exact: true })).toBeVisible()
		// A plan blocks nothing.
		await expect(senderBox(page)).toBeEnabled()

		await send(page, 'finish plan')
		const done = page.getByRole('button', { name: 'Plan 3/3' })
		await expect(done).toBeVisible()
		await expect(done).toHaveAttribute('aria-expanded', 'false')
		await expect(page.getByText('Gather the sources', { exact: true })).toBeHidden()
	})

	test('an activity shows as a read-only card in the turn', async ({ page }) => {
		await send(page, 'activity')
		const answer = answers(page).last()
		await expect(answer.getByText('Indexing finished.')).toBeVisible()
		// Spec §6.4: a Card titled with the activityType; a flat content as Descriptions, after its deltas (done 3 of 3).
		const card = answer
			.locator('.ant-card')
			.filter({ has: page.getByText('progress', { exact: true }) })
		await expect(card.getByRole('row')).toHaveText([/label\s*Indexing/, /done\s*3/, /total\s*3/])
	})

	test('a reload restores a waiting approval and a waiting question, with the Sender blocked', async ({
		page,
		isMobile,
	}) => {
		await send(page, 'gated')
		await expect(answers(page).last().getByRole('button', { name: 'Approve' })).toBeVisible()
		// The run's end is stored before its stream closes (Task 10's settle), which ends X's request.
		await expect(stopButton(page)).toHaveCount(0)
		// Without ?isNewCvst the page opens the newest conversation: this one (spec §4.2).
		await page.goto(`/chat/${AGUI_APP.id}`)
		const approve = answers(page).last().getByRole('button', { name: 'Approve' })
		await expect(approve).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		await activate(approve, isMobile)
		await expect(answers(page).last().getByText('Done: report.pdf deleted.')).toBeVisible()

		await page.goto(`/chat/${AGUI_APP.id}?isNewCvst=1`)
		await send(page, 'question')
		await expect(pager(page, 'Question 1 of 2')).toBeVisible()
		await page.goto(`/chat/${AGUI_APP.id}`)
		await expect(pager(page, 'Question 1 of 2')).toBeVisible()
		await expect(senderBox(page)).toBeDisabled()
		await expect(hint(page)).toBeVisible()
		await activate(page.getByRole('button', { name: 'Dismiss questions' }), isMobile)
		await expect(
			answers(page)
				.last()
				.getByText(
					'Got your answers: Q: Which city? / A: (skipped) / Q: Which month? / A: (skipped)',
				),
		).toBeVisible()
	})
})
