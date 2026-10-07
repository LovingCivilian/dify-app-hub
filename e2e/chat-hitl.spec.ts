import { expect, test, type Page, type TestInfo } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

const CHATFLOW = `/chat/${APP_IDS['advanced-chat']}`
const FORM_TEXT = 'Please review the draft and approve it or request changes.'

const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** The latest assistant bubble (X Bubble: assistant bubbles are placed at the start). */
const lastAnswer = (page: Page) => page.locator('.ant-bubble-start').last()
const unique = (testInfo: TestInfo) =>
	`${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`

/** A new conversation on the chatflow app whose run pauses at the stub's Review node (`hitl` scenario). */
async function pauseRun(page: Page, query: string) {
	await page.goto(`${CHATFLOW}?isNewCvst=1`)
	await expect(senderBox(page)).toBeVisible()
	await senderBox(page).fill(query)
	await page.keyboard.press('Enter')
	await expect(lastAnswer(page).getByText(FORM_TEXT, { exact: true })).toBeVisible()
}

/** Fills the stub's two inputs (a paragraph and a select; every input is required) and approves. */
async function approve(page: Page) {
	const answer = lastAnswer(page)
	await answer.getByLabel('feedback').fill('Looks good')
	await answer.getByLabel('priority').click()
	// The Select's options open in a popup outside the bubble.
	await page.getByTitle('high', { exact: true }).click()
	await answer.getByRole('button', { name: 'Approve' }).click()
}

/** The run's panel header; WorkflowLogs may have it open already, so it is clicked only when closed. */
async function openRunPanel(page: Page) {
	const header = lastAnswer(page).getByRole('button', { name: /Workflow Nodes: / })
	await expect(header).toBeVisible()
	if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
	await expect(header).toHaveAttribute('aria-expanded', 'true')
}

// The stub's `hitl` scenario: workflow_started, the Start node, the Review node, human_input_required and
// workflow_paused; after a submission GET /workflow/<run>/events resumes it (reason: resumption,
// human_input_form_filled, the Answer node, the answer, message_end, workflow_finished).
test.describe('human input', () => {
	test('a paused chatflow shows the human input form; submitting it continues the answer in the same bubble', async ({
		page,
	}, testInfo) => {
		await pauseRun(page, `please hitl this one ${unique(testInfo)}`)
		await expect(lastAnswer(page).getByText('Time left')).toBeVisible()
		await approve(page)
		await expect(page.getByText('Approved: Looks good', { exact: true })).toBeVisible()
		await expect(page.getByText('Submitted: Approve', { exact: true })).toBeVisible()
		await expect(page.getByText('Review: Looks good (high)', { exact: true })).toBeVisible()
		// The continuation extended the paused message instead of adding a second assistant bubble.
		await expect(
			page.locator('.ant-bubble').filter({ hasText: 'Approved: Looks good' }),
		).toHaveCount(1)
		// The resumed run kept the nodes from before the pause (workflow_started, reason: resumption).
		await openRunPanel(page)
		for (const node of ['Start', 'Review', 'Answer'])
			await expect(lastAnswer(page).getByText(node, { exact: true })).toBeVisible()

		// Reopened from Dify (workers: 1: the chatflow app's latest conversation is this one): the history
		// shows the filled summary, and no form.
		await page.goto(CHATFLOW)
		await expect(lastAnswer(page).getByText('Approved: Looks good', { exact: true })).toBeVisible()
		await expect(lastAnswer(page).getByText('Submitted: Approve', { exact: true })).toBeVisible()
		await expect(
			lastAnswer(page).getByText('Review: Looks good (high)', { exact: true }),
		).toBeVisible()
		await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0)
	})

	test('a paused form reopened from the history can still be submitted', async ({
		page,
	}, testInfo) => {
		await pauseRun(page, `please hitl later ${unique(testInfo)}`)
		// Reopened before anyone answered (workers: 1, as above): the history carries the pending form.
		await page.goto(CHATFLOW)
		await expect(lastAnswer(page).getByText(FORM_TEXT, { exact: true })).toBeVisible()
		await expect(lastAnswer(page).getByRole('button', { name: 'Approve' })).toBeEnabled()
		await approve(page)
		await expect(page.getByText('Approved: Looks good', { exact: true })).toBeVisible()
		await expect(page.getByText('Submitted: Approve', { exact: true })).toBeVisible()
		await expect(
			page.locator('.ant-bubble').filter({ hasText: 'Approved: Looks good' }),
		).toHaveCount(1)
	})

	test('two clicks in a row post the form once', async ({ page }, testInfo) => {
		await pauseRun(page, `please hitl twice ${unique(testInfo)}`)
		const posts: string[] = []
		page.on('request', request => {
			if (request.method() === 'POST' && request.url().includes('/form/human_input/'))
				posts.push(request.url())
		})
		const answer = lastAnswer(page)
		await answer.getByLabel('feedback').fill('Looks good')
		await answer.getByLabel('priority').click()
		await page.getByTitle('high', { exact: true }).click()
		// The second click comes once the first one's validation has resolved and its POST has started,
		// before React re-renders the button disabled: only the form's in-flight flag stops it (two clicks
		// during the validation are already one, since antd Form rejects an out-of-date validateFields).
		await answer.getByRole('button', { name: 'Approve' }).evaluate(async (button: HTMLElement) => {
			button.click()
			await new Promise(resolve => setTimeout(resolve, 0))
			button.click()
		})
		await expect(page.getByText('Approved: Looks good', { exact: true })).toBeVisible()
		await expect(page.getByText('Submitted: Approve', { exact: true })).toBeVisible()
		expect(posts).toHaveLength(1)
	})

	test('a refused submission is reported and leaves the form submittable', async ({
		page,
	}, testInfo) => {
		await pauseRun(page, `please hitl refused ${unique(testInfo)}`)
		// Dify refuses the form (OpenAPI: 412); the route passes the envelope through.
		await page.route('**/form/human_input/**', route =>
			route.fulfill({
				status: 412,
				contentType: 'application/json',
				body: JSON.stringify({
					code: 'human_input_form_expired',
					message: 'This form has expired.',
					status: 412,
				}),
			}),
		)
		await approve(page)
		await expect(
			page.getByText('Submission failed: This form has expired.', { exact: true }),
		).toBeVisible()
		await expect(lastAnswer(page).getByRole('button', { name: 'Approve' })).toBeEnabled()
		await expect(lastAnswer(page).getByLabel('feedback')).toHaveValue('Looks good')
	})

	test('the form definition is read from Dify when the form arrives and when it is reopened', async ({
		page,
	}, testInfo) => {
		const forms = page.waitForRequest(
			request =>
				request.method() === 'GET' &&
				/\/form\/human_input\/[^/]+$/.test(new URL(request.url()).pathname),
		)
		await pauseRun(page, `please hitl definition ${unique(testInfo)}`)
		await forms
		// The stub's definition lists the select options; the form shows them.
		await lastAnswer(page).getByLabel('priority').click()
		await expect(page.getByTitle('high', { exact: true })).toBeVisible()
		await page.keyboard.press('Escape')
		// Reopened from the history (workers: 1, as above; a reload would keep ?isNewCvst=1 and open a new
		// chat): read again.
		const again = page.waitForRequest(
			request =>
				request.method() === 'GET' &&
				/\/form\/human_input\/[^/]+$/.test(new URL(request.url()).pathname),
		)
		await page.goto(CHATFLOW)
		await again
		await expect(lastAnswer(page).getByRole('button', { name: 'Approve' })).toBeVisible()
	})

	// Review Focus 5: a form already past its expiration_time renders expired, never as a countdown.
	test('a form that arrives expired shows the expired state with its controls disabled', async ({
		page,
	}, testInfo) => {
		await pauseRun(page, `please hitl expired ${unique(testInfo)}`)
		const answer = lastAnswer(page)
		await expect(
			answer.getByText('This form can no longer be submitted.', { exact: true }),
		).toBeVisible()
		await expect(answer.getByText('Time left')).toHaveCount(0)
		await expect(answer.getByLabel('feedback')).toBeDisabled()
		await expect(answer.getByRole('button', { name: 'Approve' })).toBeDisabled()
		await expect(answer.getByRole('button', { name: 'Request changes' })).toBeDisabled()
	})

	test('a form delivered elsewhere says so and cannot be submitted here', async ({
		page,
	}, testInfo) => {
		await pauseRun(page, `please hitl by email ${unique(testInfo)}`)
		const answer = lastAnswer(page)
		await expect(
			answer.getByText(
				'This form was delivered by email or to the Dify console and can only be answered there.',
				{ exact: true },
			),
		).toBeVisible()
		await expect(answer.getByLabel('feedback')).toBeDisabled()
		await expect(answer.getByRole('button', { name: 'Approve' })).toBeDisabled()
	})
})
