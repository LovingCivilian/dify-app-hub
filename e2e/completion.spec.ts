import { expect, test, type Page, type Request } from '@playwright/test'

import { APP_IDS } from './fixtures/constants'

/** The run button; antd adds a loading icon to its name while a run streams. */
const runButton = (page: Page) => page.getByRole('button', { name: 'Run' })

test.describe('completion app', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`/chat/${APP_IDS.completion}`)
		await expect(runButton(page)).toBeVisible()
	})

	test('a completion app renders the generated text with a copy action', async ({
		page,
		context,
	}) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write'])
		await expect(page.getByText('Click "Run" to try it out.', { exact: true })).toBeVisible()
		await runButton(page).click()
		await expect(page.getByText('Topic is required')).toBeVisible()
		await page.getByLabel('Topic').fill('coffee')
		await runButton(page).click()
		await expect(page.getByText('A short note about coffee.')).toBeVisible()
		// antd's Typography copy button inside X's Actions.Copy, named by antd's locale.
		await page.getByRole('button', { name: 'Copy' }).click()
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe('A short note about coffee.')
		// Spec §5.4: no node logs and no tabs for completion apps.
		await expect(page.getByText('Workflow', { exact: true })).toHaveCount(0)
		await expect(page.getByRole('tab')).toHaveCount(0)
	})

	test('stopping keeps the text so far and marks it stopped', async ({ page }) => {
		await page.getByLabel('Topic').fill('slow coffee')
		await runButton(page).click()
		const partial = page.getByText(/^0 1 2/)
		await expect(partial).toBeVisible()
		const cancelled = page.waitForEvent('requestfailed', request =>
			new URL(request.url()).pathname.endsWith('/completion-messages'),
		)
		// Charter §4.1: the stop also reaches Dify for the run's task, once per click.
		const isStop = (request: Request) =>
			request.method() === 'POST' &&
			/\/completion-messages\/[^/]+\/stop$/.test(new URL(request.url()).pathname)
		const stops: string[] = []
		page.on('request', request => {
			if (isStop(request)) stops.push(request.url())
		})
		const stopped = page.waitForRequest(isStop)
		await page.getByRole('button', { name: 'Stop', exact: true }).click()
		await cancelled
		await stopped
		await expect(page.getByText('Stopped', { exact: true })).toBeVisible()
		await expect(partial).not.toContainText('37 38 39')
		expect(stops).toHaveLength(1)
	})

	test('a stream error shows the failed run with its message', async ({ page }) => {
		await page.getByLabel('Topic').fill('error')
		await runButton(page).click()
		await expect(page.getByText('The run failed', { exact: true })).toBeVisible()
		await expect(page.getByText('The model is unavailable.', { exact: true })).toBeVisible()
		await expect(page.getByText('A short note', { exact: false })).toHaveCount(0)
	})
})
