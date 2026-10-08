import { expect, test, type Page } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'
import { REASONING } from './fixtures/stub/scenarios'

const senderBox = (page: Page) => page.getByPlaceholder('Type a message')

/**
 * The run's panel header (antd Collapse: a button with aria-expanded). WorkflowLogs opens it by itself
 * while the run streams, so it is clicked only when it is closed: a plain click would close it again.
 */
async function openRunPanel(page: Page) {
	const header = page.getByRole('button', { name: /Workflow Nodes: / })
	await expect(header).toBeVisible()
	if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
	await expect(header).toHaveAttribute('aria-expanded', 'true')
}

// The stub's chatflow default scenario: workflow_started, the Start and Answer nodes, two reasoning_chunk
// events (the second with is_final), the answer, message_end and workflow_finished.
test.describe('chatflow', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_IDS['advanced-chat']}?isNewCvst=1`)
		await expect(senderBox(page)).toBeVisible()
	})

	test('shows the workflow nodes, the reasoning block and the answer', async ({
		page,
	}, testInfo) => {
		const text = `hello flow ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
		// The reasoning closed with its final chunk and shows the time it took.
		const reasoning = page.getByRole('group', { name: 'Reasoning' })
		await expect(reasoning.getByText(/^Finished thinking \(\d+\.\ds\)$/)).toBeVisible()
		await expect(page.getByText('The user greets me.')).toHaveCount(0)
		await reasoning.getByText(/^Finished thinking/).click()
		await expect(page.getByText(REASONING.join(''), { exact: true })).toBeVisible()
		await openRunPanel(page)
		await expect(page.getByText('Start', { exact: true })).toBeVisible()
		await expect(page.getByText('Answer', { exact: true })).toBeVisible()
		await page.getByText('Answer', { exact: true }).click()
		await expect(page.getByText('Output', { exact: true })).toBeVisible()
	})

	// Dify's own chat puts the run first, then the thinking, then the answer (1.17.1,
	// web/app/components/base/chat/chat/answer/index.tsx). The thinking streams as reasoning_chunk events only and
	// GET /messages has no field for it, so the chat keeps the streamed text in the browser beside the nodes.
	test('puts the reasoning under the run, and brings it back after a reload', async ({
		page,
	}, testInfo) => {
		const text = `hello again ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
		const answer = page.locator('.ant-bubble-start').last()
		const run = answer.getByRole('button', { name: /Workflow Nodes: / })
		const reasoning = answer.getByRole('group', { name: 'Reasoning' })
		const top = async (locator: typeof run) => (await locator.boundingBox())?.y ?? Number.NaN
		expect(await top(run)).toBeLessThan(await top(reasoning))
		// Reopened from Dify (workers: 1: the chatflow app's latest conversation is this one).
		await page.goto(`/chat/${APP_IDS['advanced-chat']}`)
		const reopened = page.locator('.ant-bubble-start').last()
		await expect(reopened.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
		const kept = reopened.getByRole('group', { name: 'Reasoning' })
		await expect(kept.getByText(/^Finished thinking \(\d+\.\ds\)$/)).toBeVisible()
		await kept.getByText(/^Finished thinking/).click()
		await expect(reopened.getByText(REASONING.join(''), { exact: true })).toBeVisible()
		expect(await top(reopened.getByRole('button', { name: /Workflow Nodes: / }))).toBeLessThan(
			await top(kept),
		)
	})

	// The stub's `nodefail` scenario is Dify's documented chatflow failure: the Answer node fails, then
	// workflow_finished (failed) and `error`; no answer text and no message_end.
	test('a failed run keeps its node logs with the error, live and after a reload', async ({
		page,
	}, testInfo) => {
		const text = `nodefail please ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		const answer = page.locator('.ant-bubble-start').last()
		await expect(answer.getByRole('alert')).toContainText('The model is unavailable.')
		await openRunPanel(page)
		await expect(page.getByRole('button', { name: /Failed Workflow Nodes: / })).toBeVisible()
		await answer.getByText('Answer', { exact: true }).click()
		await expect(answer.getByText('Error', { exact: true })).toBeVisible()
		// Reopened from Dify (workers: 1: the chatflow app's latest conversation is this one): the turn is
		// failed in the history, and its stored node data comes back with it.
		await page.goto(`/chat/${APP_IDS['advanced-chat']}`)
		await expect(page.locator('.ant-bubble-start').last().getByRole('alert')).toContainText(
			'The model is unavailable.',
		)
		await expect(page.getByRole('button', { name: /Failed Workflow Nodes: / })).toBeVisible()
	})

	test('marks a retried node', async ({ page }, testInfo) => {
		const text = `retry once please ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
		await openRunPanel(page)
		await expect(page.getByText('Retried 1×', { exact: true })).toBeVisible()
	})
})
