import { expect, test, type Page } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

// Cosmetic sweep 1, item 1: the message list's scroll box spans the chat's content region, so its scrollbar
// sits at the region's edge in both reading widths, while the bubbles share the Sender's width.

const senderBox = (page: Page) => page.getByPlaceholder('Type a message')
/** The chat's own Layout.Content (the region beside the sider), the innermost content of the nested layouts. */
const contentRegion = (page: Page) => page.locator('.ant-layout-content').last()
const scrollBox = (page: Page) => page.locator('.ant-bubble-list-scroll-box')

const edges = async (locator: ReturnType<Page['locator']>) => {
	const box = await locator.boundingBox()
	return { left: Math.round(box!.x), right: Math.round(box!.x + box!.width) }
}
/** X's scroll content insets every bubble by `paddingXS` on each side (es/bubble/style/list.js). */
const BUBBLE_INSET = 8

test('the message list scrolls at the content region edge and the bubbles share the Sender width, narrow and wide', async ({
	page,
	isMobile,
}) => {
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	await senderBox(page).fill('layout probe')
	await page.keyboard.press('Enter')
	await expect(page.getByText('Echo: layout probe')).toBeVisible()
	const bubble = page.locator('.ant-bubble').last()
	const sender = page.locator('.ant-sender')
	const check = async () => {
		expect((await edges(scrollBox(page))).right).toBe((await edges(contentRegion(page))).right)
		const [bubbleEdges, senderEdges] = await Promise.all([edges(bubble), edges(sender)])
		expect(bubbleEdges).toEqual({
			left: senderEdges.left + BUBBLE_INSET,
			right: senderEdges.right - BUBBLE_INSET,
		})
	}
	await check()
	if (isMobile) return
	// Narrow mode on a desktop: the reading width (screenMD 768) bounds the bubbles.
	expect((await bubble.boundingBox())!.width).toBeLessThanOrEqual(768)
	await page
		.locator('header.ant-layout-header')
		.getByRole('button', { name: /wide|narrow/i })
		.click()
	await expect.poll(async () => (await bubble.boundingBox())!.width).toBeGreaterThan(768)
	await check()
})
