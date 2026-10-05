import { expect, test, type Page } from '@playwright/test'
import { gzipSync } from 'node:zlib'

import { APP_IDS } from './fixtures/constants'

/** The run button; antd adds a loading icon to its name while a run streams. */
const runButton = (page: Page) => page.getByRole('button', { name: 'Run' })

/** A link's input value as `unParseGzipString` reads it: gzip, base64, then URL-encoded. */
const gzipParam = (text: string) => encodeURIComponent(gzipSync(text).toString('base64'))

test.describe('workflow app', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_IDS.workflow}`)
		await expect(runButton(page)).toBeVisible()
	})

	test('a required input blocks the run until filled, then logs and result appear', async ({
		page,
	}) => {
		// Spec §5.4: Empty before the first run.
		await expect(page.getByText('Click "Run" to try it out.', { exact: true })).toBeVisible()
		await runButton(page).click()
		await expect(page.getByText('Topic is required')).toBeVisible()
		await page.getByLabel('Topic').fill('tea')
		await runButton(page).click()
		await expect(page.getByText('A short note about tea.')).toBeVisible()
		await expect(page.getByText('Start', { exact: true })).toBeVisible()
		await expect(page.getByText('Answer', { exact: true })).toBeVisible()
		// workflow_finished `files`: the generated image shows in the result tab.
		await expect(page.getByRole('img', { name: 'stub-image.png' })).toBeVisible()
		await page.getByRole('tab', { name: 'Details' }).click()
		await expect(page.getByText('"text": "A short note about tea."')).toBeVisible()
		await expect(
			page.getByRole('tabpanel', { name: 'Details' }).getByRole('button', { name: 'Copy' }),
		).toBeVisible()
	})

	test('stopping a run cancels its stream, keeps what arrived and marks it stopped', async ({
		page,
	}) => {
		await page.getByLabel('Topic').fill('slow tea')
		await runButton(page).click()
		const partial = page.getByText(/^0 1 2/)
		await expect(partial).toBeVisible()
		// stop() cancels the response body, which ends the fetch: Chromium reports the request as failed.
		const cancelled = page.waitForEvent('requestfailed', request =>
			new URL(request.url()).pathname.endsWith('/workflows/run'),
		)
		await page.getByRole('button', { name: 'Stop', exact: true }).click()
		await cancelled
		await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
		await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
		// The logs no longer spin: the unfinished run shows as failed (Task 12's displayWorkflow).
		await expect(page.getByRole('img', { name: 'Running' })).toHaveCount(0)
		await expect(partial).toBeVisible()
		await expect(partial).not.toContainText('37 38 39')
		// A new run starts from scratch: nothing of the stopped stream reaches it.
		await page.getByLabel('Topic').fill('tea')
		await runButton(page).click()
		await expect(page.getByText('A short note about tea.')).toBeVisible()
		await expect(page.getByText('Stopped', { exact: true })).toHaveCount(0)
		await expect(page.getByText(/^0 1 2/)).toHaveCount(0)
	})

	test('a failed run shows the error with the failed node', async ({ page }) => {
		await page.getByLabel('Topic').fill('error')
		await runButton(page).click()
		await expect(page.getByText('The run failed', { exact: true })).toBeVisible()
		await expect(page.getByText('The model is unavailable.', { exact: true })).toBeVisible()
		// The run and its Answer node carry the failed status icon.
		await expect(page.getByRole('img', { name: 'Failed' })).toHaveCount(2)
	})

	test("a run Dify refuses shows Dify's message", async ({ page }) => {
		await page.getByLabel('Topic').fill('invalid tea')
		await runButton(page).click()
		await expect(page.getByText('The run failed', { exact: true })).toBeVisible()
		await expect(page.getByText('topic is not valid.', { exact: true })).toBeVisible()
	})

	test("a link's input value prefills the form (spec §4.7)", async ({ page }) => {
		await page.goto(`/chat/${APP_IDS.workflow}?topic=${gzipParam('green tea')}`)
		await expect(page.getByLabel('Topic')).toHaveValue('green tea')
		await runButton(page).click()
		await expect(page.getByText('A short note about green tea.')).toBeVisible()
	})
})
