import { expect, test, type Page } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** The newest assistant bubble (placement start). */
const lastAnswer = (page: Page) => page.locator('.ant-bubble-start').last()

test.describe('errors and stopping', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
		await expect(senderBox(page)).toBeVisible()
	})

	// The stub's `error` scenario streams "Echo: " and then an `error` event; it stores the turn with
	// `status: 'error'`, so reopening the conversation shows the same bubble from the history.
	test('a stream error shows inside the bubble, live and after a reload', async ({
		page,
	}, testInfo) => {
		const text = `cause an error ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		const alert = lastAnswer(page).getByRole('alert')
		await expect(alert).toContainText('The model is unavailable.')
		await expect(lastAnswer(page)).toContainText('Echo:')
		// Reopened from Dify (workers: 1: the chat app's latest conversation is this one).
		await page.goto(`/chat/${APP_ID}`)
		await expect(page.locator('.ant-bubble-end').last()).toHaveText(text)
		await expect(lastAnswer(page).getByRole('alert')).toContainText('The model is unavailable.')
	})

	test('stopping keeps the partial answer and marks it stopped', async ({ page }, testInfo) => {
		const text = `slow reply ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
		await senderBox(page).fill(text)
		await page.keyboard.press('Enter')
		await expect(page.getByText(/^0 1 2/)).toBeVisible()
		// Spec §4.5: abort, then Dify's stop endpoint for the reply's task (through the app's proxy).
		const stopRequest = page.waitForRequest(
			request =>
				request.method() === 'POST' &&
				/\/chat-messages\/[^/]+\/stop$/.test(new URL(request.url()).pathname),
		)
		// X Sender's loading button is named through the X locale (Sender.stopLoading).
		await page.getByRole('button', { name: 'Stop loading' }).click()
		await stopRequest
		await expect(lastAnswer(page).getByText('Stopped', { exact: true })).toBeVisible()
		await expect(lastAnswer(page)).toContainText('0 1 2')
		await expect(lastAnswer(page)).not.toContainText('37 38 39')
	})
})
