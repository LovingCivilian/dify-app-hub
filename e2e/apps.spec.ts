import { expect, test } from '@playwright/test'

import { APP_ID, DISABLED_APP, NO_SITE_APP } from './fixtures/constants'

const card = (name: string) => ({ name: new RegExp(name) })

test('the app list shows enabled apps as links to their chat and hides disabled ones', async ({
	page,
}) => {
	await page.goto('/apps')
	await expect(page.getByRole('link', card('Stub app'))).toHaveAttribute('href', `/chat/${APP_ID}`)
	await expect(page.getByRole('link', card(NO_SITE_APP.name))).toBeVisible()
	await expect(page.getByText(DISABLED_APP.name)).toHaveCount(0)
	// The page frames itself: the padding sits on a plain wrapper, because a module class on antd's Flex loses
	// to its `margin: 0; padding: 0` reset (the heading's left edge was 0 before).
	const box = await page.getByRole('heading', { name: 'Apps' }).boundingBox()
	expect(box!.x).toBeGreaterThanOrEqual(16)
})

// E10 and E11: the card names the provider and the type; without a stored image it shows the provider's icon.
test('a card names its provider and type, and shows the provider icon when no image is stored', async ({
	page,
}) => {
	await page.goto('/apps')
	const stub = page.getByRole('link', card('Stub app'))
	await expect(stub.getByText('Dify · Chatbot', { exact: true })).toBeVisible()
	// antd icons render role="img" named after the icon: Dify's fallback is ApartmentOutlined.
	await expect(stub.getByRole('img', { name: 'apartment' })).toBeVisible()
	// The seeded row's emoji (Dify's /site icon) is no longer shown (decision 19).
	await expect(stub.getByText('🤖')).toHaveCount(0)
	await expect(
		page.getByRole('link', card(NO_SITE_APP.name)).getByText('Dify · Workflow', { exact: true }),
	).toBeVisible()
})

test('search narrows the list case-insensitively and a miss says so', async ({ page }) => {
	await page.goto('/apps')
	const search = page.getByRole('textbox', { name: 'Search apps' })
	await search.fill('  AGENT ')
	await expect(page.getByRole('link', card('Stub agent'))).toBeVisible()
	await expect(page.getByRole('link', card('Stub app'))).toHaveCount(0)
	await search.fill('no such app')
	await expect(page.getByText('No apps match your search')).toBeVisible()
})

test('on a phone the app list never scrolls sideways', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'a phone-width check')
	await page.goto('/apps')
	await expect(page.getByRole('link', card('Stub app'))).toBeVisible()
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	)
})
