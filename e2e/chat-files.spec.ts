import { expect, test, type Page } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

const senderBox = (page: Page) => page.getByPlaceholder('Type a message')

// The stub's `files` scenario (any chat-like app) streams the answer and a `message_file` image that the
// assistant produced; the stub serves the PNG itself.
test('an image the assistant produced renders with a preview', async ({ page }, testInfo) => {
	const text = `send files please ${testInfo.project.name} ${testInfo.repeatEachIndex}.${testInfo.retry}`
	await page.goto(`/chat/${APP_ID}?isNewCvst=1`)
	await senderBox(page).fill(text)
	await page.keyboard.press('Enter')
	await expect(page.getByText(`Echo: ${text}`, { exact: true })).toBeVisible()
	// The stream names no file, so the image is described by the generic text.
	const files = page.getByRole('group', { name: 'Files' })
	const image = files.getByRole('img', { name: 'Image from the answer' })
	await expect(image).toBeVisible()
	// A thumbnail three control heights square (antd's default controlHeight is 32), not the 1×1 PNG's size.
	await expect(image).toHaveCSS('width', '96px')
	await expect(image).toHaveCSS('height', '96px')
	await image.click()
	const preview = page.locator('.ant-image-preview')
	await expect(preview).toBeVisible()
	// The preview fades in; an Escape during that motion can leave antd's preview stuck mid-close (seen under
	// next dev on Markdown images too), so it is closed once it has opened.
	await expect(preview).not.toHaveClass(/-fade-appear/)
	await page.keyboard.press('Escape')
	await expect(preview).toBeHidden()
})
