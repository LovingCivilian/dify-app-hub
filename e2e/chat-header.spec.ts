import { expect, test } from '@playwright/test'

import { APP_ID } from './fixtures/constants'

test('the chat keeps its title, width toggle (md up) and account menu in the shell header', async ({
	page,
}, testInfo) => {
	await page.goto(`/chat/${APP_ID}`)
	const header = page.locator('header.ant-layout-header')
	await expect(header).toHaveCount(1)
	await expect(header.getByText('Stub app')).toBeVisible()
	if (testInfo.project.name.startsWith('mobile')) {
		await expect(header.getByRole('button', { name: 'Menu' })).toBeVisible()
		// Below md the column already spans the viewport, so the width toggle is not offered there.
		await expect(header.getByRole('button', { name: /wide|narrow/i })).toBeHidden()
	} else {
		await expect(header.getByRole('button', { name: /wide|narrow/i })).toBeVisible()
		await header.getByRole('button', { name: /signed in as/i }).click()
		await expect(page.getByRole('menuitem', { name: /log out/i })).toBeVisible()
	}
})
