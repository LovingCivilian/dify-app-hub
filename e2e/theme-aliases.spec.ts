import { expect, test } from '@playwright/test'

// No page uses the text-theme-* classes since sub-project 3, but the alias block lives on .ant-app until
// sub-project 4 (ADR-0012). The test adds its own element instead of a product-code test switch (ADR-0010).
test('the legacy theme classes follow antd tokens in both colour schemes', async ({
	page,
}, testInfo) => {
	await page.goto('/apps')
	// The alias block is declared on `.ant-app` (ADR-0012). The probe sits in a wrapper that carries the App
	// root's class and is appended to <body>, outside the subtree React hydrates, so it cannot be dropped
	// as a hydration mismatch.
	// React 19 skips unexpected tags in <head> and <body> while hydrating instead of reporting a mismatch
	// (react.dev, "React 19" release notes, "Compatibility with third-party scripts and extensions").
	await page.locator('.ant-app').first().waitFor()
	await page.evaluate(() => {
		const root = document.querySelector('.ant-app')
		if (!root) throw new Error('no .ant-app root')
		const wrapper = document.createElement('div')
		wrapper.className = root.className
		const probe = document.createElement('span')
		probe.className = 'text-theme-desc'
		probe.dataset.testid = 'alias-probe'
		probe.textContent = 'alias probe'
		wrapper.append(probe)
		document.body.append(wrapper)
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
