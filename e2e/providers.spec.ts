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

// The X locale is merged into the one XProvider next to antd's (libs/x-locale.ts): the Sender's stop control
// is named by X's locale. The language is switched in the page, so the locale follows a live change (a hard load
// in Arabic is covered by ssr-first-paint.spec.ts). The stub streams a `slow` reply for four seconds, so the
// control stays on screen.
test("Ant Design X's strings follow the language through the one XProvider", async ({
	page,
	isMobile,
}) => {
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	const textbox = page.getByRole('textbox').first()
	await expect(textbox).toBeVisible()
	// Below md the header's own language control is hidden; the drawer holds a copy (ADR-0014).
	if (isMobile) {
		await page
			.locator('header.ant-layout-header')
			.getByRole('button', { name: 'Menu', exact: true })
			.click()
	}
	const controls = isMobile ? page.getByRole('dialog', { name: 'Conversations menu' }) : page
	await controls.getByRole('button', { name: 'Language' }).click()
	await page.getByRole('menuitem', { name: 'العربية' }).click()
	await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
	if (isMobile) await page.keyboard.press('Escape')
	await textbox.fill('slow locale check')
	await page.keyboard.press('Enter')
	const stop = page.getByRole('button', { name: 'إيقاف التحميل' })
	await expect(stop).toBeVisible()
	// End the stream once chunks flow (the stub's slow reply counts "0 1 2 …"), not while the request is still
	// being sent and not by leaving it running while the page closes.
	await expect(page.getByText(/^0 1 2/)).toBeVisible()
	await stop.click()
	await expect(stop).toHaveCount(0)
})
