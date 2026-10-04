import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

// antd 6 publishes its tokens as --ant-* variables on the class it puts on <App>'s root (measured 2026-10-04:
// light color-bg-layout #f5f5f5, dark #000000). One App root means one provider stack.
test('exactly one antd App root exists and its tokens follow the colour scheme', async ({
	page,
}, testInfo) => {
	await page.goto('/apps')
	const roots = page.locator('.ant-app')
	await expect(roots).toHaveCount(1)
	// The server renders light and the client switches to dark after hydration: retry the read.
	await expect
		.poll(() =>
			roots
				.first()
				.evaluate(el => getComputedStyle(el).getPropertyValue('--ant-color-bg-layout').trim()),
		)
		.toBe(testInfo.project.use.colorScheme === 'dark' ? '#000000' : '#f5f5f5')
})

test('no page nests a second XProvider or ConfigProvider', async ({ page }) => {
	// The chat page carried the nested chat XProvider (2–3 css-var classes before the root stack, depending on
	// the run) and is where one would return; the admin pages only ever had one stack.
	await page.goto(`/chat/${APP_ID}`)
	// The session gate shows only a spinner at first: wait until the chat body (where a nested provider would
	// live) is mounted, or the count below checks nothing.
	await expect(page.getByRole('textbox').first()).toBeVisible()
	// Every ConfigProvider/XProvider instance registers its own CSS-variable class; one stack = one class name.
	const classes = await page
		.locator('[class*="css-var-"]')
		.evaluateAll(
			els =>
				new Set(els.flatMap(el => [...el.classList].filter(c => c.startsWith('css-var-')))).size,
		)
	expect(classes).toBe(1)
})
