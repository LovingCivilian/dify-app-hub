import { expect, test } from '@playwright/test'

// No page uses the text-theme-* classes since sub-project 3, but the alias block lives on .ant-app until
// sub-project 4 (ADR-0012). The test adds its own element inside the App root instead of a product-code test
// switch (ADR-0010).
test('the legacy theme classes follow antd tokens in both colour schemes', async ({
	page,
}, testInfo) => {
	await page.goto('/apps')
	await page
		.locator('.ant-app')
		.first()
		.evaluate(root => {
			const probe = document.createElement('span')
			probe.className = 'text-theme-desc'
			probe.dataset.testid = 'alias-probe'
			probe.textContent = 'alias probe'
			root.append(probe)
		})
	const el = page.getByTestId('alias-probe')
	await expect(el).toBeVisible()
	// antd's colorTextSecondary: rgba(0,0,0,0.65) under defaultAlgorithm, rgba(255,255,255,0.65) under darkAlgorithm.
	// toHaveCSS retries, so the dark project waits for the client's switch to dark after hydration.
	await expect(el).toHaveCSS(
		'color',
		testInfo.project.use.colorScheme === 'dark'
			? 'rgba(255, 255, 255, 0.65)'
			: 'rgba(0, 0, 0, 0.65)',
	)
})
