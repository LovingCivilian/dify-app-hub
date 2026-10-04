import { expect, test } from '@playwright/test'

// Old page bodies still use the text-theme-* classes; after this task those resolve to antd tokens.
test('the legacy theme classes follow antd tokens in both colour schemes', async ({
	page,
}, testInfo) => {
	await page.goto('/apps')
	const el = page.locator('.text-theme-desc').first()
	await expect(el).toBeVisible()
	const color = await el.evaluate(node => getComputedStyle(node).color)
	// antd's colorTextSecondary: rgba(0,0,0,0.65) under defaultAlgorithm, rgba(255,255,255,0.65) under darkAlgorithm.
	expect(color).toBe(
		testInfo.project.use.colorScheme === 'dark'
			? 'rgba(255, 255, 255, 0.65)'
			: 'rgba(0, 0, 0, 0.65)',
	)
})
