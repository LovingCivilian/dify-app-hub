import { expect, test, type Page } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

// Cosmetic sweep 1, item 1: the message list's scroll box spans the chat's content region, so its scrollbar
// sits at the region's edge in both reading widths, while the bubbles keep the reading width.

const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** The chat's own Layout.Content (the region beside the sider), the innermost content of the nested layouts. */
const contentRegion = (page: Page) => page.locator('.ant-layout-content').last()
const scrollBox = (page: Page) => page.locator('.ant-bubble-list-scroll-box')

const rightEdge = async (locator: ReturnType<Page['locator']>) => {
	const box = await locator.boundingBox()
	return Math.round(box!.x + box!.width)
}

test('the message list scrolls at the content region edge, narrow and wide', async ({
	page,
	isMobile,
}) => {
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	await senderBox(page).fill('layout probe')
	await page.keyboard.press('Enter')
	await expect(page.getByText('Echo: layout probe')).toBeVisible()
	expect(await rightEdge(scrollBox(page))).toBe(await rightEdge(contentRegion(page)))
	// The bubbles keep the reading width (screenMD = 768) in the narrow mode on a desktop.
	const bubble = page.locator('.ant-bubble').last()
	if (!isMobile) expect((await bubble.boundingBox())!.width).toBeLessThanOrEqual(768)
	if (isMobile) return
	const toggle = page
		.locator('header.ant-layout-header')
		.getByRole('button', { name: /wide|narrow/i })
	await toggle.click()
	await expect.poll(async () => (await bubble.boundingBox())!.width).toBeGreaterThan(768)
	expect(await rightEdge(scrollBox(page))).toBe(await rightEdge(contentRegion(page)))
})
