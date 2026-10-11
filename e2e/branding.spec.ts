import { expect, test, type Page } from '@playwright/test'

import { pngOf, resetBranding } from './fixtures/branding'
import { APP_ID } from './fixtures/constants'
import { deleteUsersLike, seedUser, signInAs } from './fixtures/users'

// Settings spec §4.6: with nothing saved the hub shows its built-in brand; the header has no GitHub button.
test.describe('the built-in brand', () => {
	test('the header and the tab show it, and the GitHub button is gone', async ({ page }) => {
		await page.goto('/apps')
		await expect(page).toHaveTitle('Dify App Hub')
		await expect(page.getByRole('banner').getByRole('link', { name: 'Dify App Hub' })).toBeVisible()
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
			'href',
			/\/_next\/static\/media\/logo/,
		)
		await expect(page.getByRole('button', { name: 'GitHub' })).toHaveCount(0)
		await expect(page.getByRole('link', { name: 'GitHub' })).toHaveCount(0)
	})

	test('the login page shows the name under the logo', async ({ browser }) => {
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		const page = await context.newPage()
		await page.goto('/login')
		await expect(page.getByRole('heading', { name: 'Dify App Hub' })).toBeVisible()
		// The built-in image through Next's optimizer, as before (spec §4.6); signed out, so /_next/image must stay
		// outside the proxy (proxy.ts matcher). It is alt="" beside the name, so it has no img role to find it by.
		const logo = page.locator('img[src^="/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Flogo"]')
		await expect(logo).toBeVisible()
		// MDN HTMLImageElement.naturalWidth: 0 while "the image data is not available".
		await expect
			.poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
			.toBeGreaterThan(0)
		await context.close()
	})
})

const nameOf = () => `Acme ${test.info().project.name}`

/** Chooses a file through the Upload button; retried until hydration has wired the button (Playwright "File chooser"). */
const chooseFile = async (
	page: Page,
	button: string,
	file: { name: string; mimeType: string; buffer: Buffer },
) => {
	await expect(async () => {
		const chooser = page.waitForEvent('filechooser', { timeout: 2_000 })
		await page.getByRole('button', { name: button }).click()
		await (await chooser).setFiles(file)
	}).toPass()
}

test.describe('the Branding page (settings spec §5.3)', () => {
	test.afterEach(async () => {
		await resetBranding()
	})

	test('an admin reaches it from the navigation', async ({ page, isMobile }) => {
		await page.goto('/app-management')
		if (isMobile) {
			await expect(async () => {
				await page.getByRole('button', { name: 'Menu' }).click()
				await expect(page.getByRole('dialog').getByRole('link', { name: 'Branding' })).toBeVisible({
					timeout: 1_000,
				})
			}).toPass()
			await page.getByRole('dialog').getByRole('link', { name: 'Branding' }).click()
		} else {
			await page.getByRole('complementary').getByRole('link', { name: 'Branding' }).click()
		}
		await expect(page).toHaveURL(/\/settings\/branding$/)
		await expect(page.getByRole('heading', { name: 'Branding' })).toBeVisible()
		await expect(page.getByText('Branding is stored in the database.')).toBeVisible()
		await page.goto('/settings')
		await expect(page).toHaveURL(/\/settings\/branding$/)
	})

	test('a saved name and logo reach the header, the tab and the login page', async ({
		page,
		browser,
	}) => {
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose logo', {
			name: 'logo.png',
			mimeType: 'image/png',
			buffer: await pngOf(400, 100),
		})
		await page.getByLabel('Name', { exact: true }).fill(nameOf())
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText('Branding saved')).toBeVisible()

		const home = page.getByRole('banner').getByRole('link', { name: nameOf() })
		await expect(home).toBeVisible()
		await expect(home.locator('img')).toHaveAttribute(
			'src',
			/\/api\/branding\/logo\?v=[0-9a-f]{16}/,
		)
		await expect(page).toHaveTitle(nameOf())
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
			'href',
			/\/api\/branding\/favicon\?v=[0-9a-f]{16}/,
		)

		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
		const login = await context.newPage()
		await login.goto('/login')
		await expect(login.getByRole('heading', { name: nameOf() })).toBeVisible()
		const image = await login.request.get('/api/branding/logo')
		expect(image.status()).toBe(200)
		expect(image.headers()['content-type']).toBe('image/png')
		await context.close()
	})

	test('with the name hidden, the header shows the logo alone and keeps the name for assistive technology', async ({
		page,
	}) => {
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose logo', {
			name: 'logo.png',
			mimeType: 'image/png',
			buffer: await pngOf(400, 100),
		})
		await page.getByLabel('Name', { exact: true }).fill(nameOf())
		await page.getByRole('switch', { name: 'Show the name beside the logo' }).click()
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText('Branding saved')).toBeVisible()
		const home = page.getByRole('banner').getByRole('link', { name: nameOf() })
		await expect(home.locator('img')).toBeVisible()
		await expect(home.getByText(nameOf())).toHaveCount(0)
	})

	test('removing the logo leaves the name, and the tab falls back to the built-in icon', async ({
		page,
	}) => {
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose logo', {
			name: 'logo.png',
			mimeType: 'image/png',
			buffer: await pngOf(400, 100),
		})
		await page.getByLabel('Name', { exact: true }).fill(nameOf())
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText('Branding saved')).toBeVisible()
		await page.getByRole('button', { name: 'Remove' }).click()
		await expect(page.getByRole('switch', { name: 'Show the name beside the logo' })).toBeDisabled()
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(
			page.getByRole('banner').getByRole('link', { name: nameOf() }).locator('img'),
		).toHaveCount(0)
		await expect(page.getByRole('banner').getByText(nameOf())).toBeVisible()
		await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
			'href',
			/\/_next\/static\/media\/logo/,
		)
	})

	test('the browser refuses a file type the hub does not take', async ({ page }) => {
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose icon', {
			name: 'icon.gif',
			mimeType: 'image/gif',
			buffer: Buffer.from('GIF89a'),
		})
		await expect(
			page.getByText('Use a PNG, JPEG or WebP image that opens correctly.'),
		).toBeVisible()
	})

	// Beside a logo, the longest name (64 characters, spec §4.1) is cut with an ellipsis inside the header's left region
	// (app-header.module.css `.title`: MDN text-overflow) instead of running into the chat title or the controls.
	test('a 64-character name beside the logo is cut inside the left region of the header', async ({
		page,
		isMobile,
	}) => {
		test.skip(isMobile, 'below md the header shows the logo without the name (.title)')
		const longName = 'A'.repeat(64)
		await page.goto('/settings/branding')
		await chooseFile(page, 'Choose logo', {
			name: 'logo.png',
			mimeType: 'image/png',
			buffer: await pngOf(400, 100),
		})
		await page.getByLabel('Name', { exact: true }).fill(longName)
		await page.getByRole('button', { name: 'Save' }).click()
		await expect(page.getByText('Branding saved')).toBeVisible()

		// An admin page (the left region beside the controls) and a chat page (beside the centred app title).
		for (const path of ['/settings/branding', `/chat/${APP_ID}`]) {
			await page.goto(path)
			const home = page.getByRole('banner').getByRole('link', { name: longName })
			// The element that carries the name inside the link: Typography.Text's root span, which holds the .title class.
			const name = home.locator('span', { hasText: longName })
			await expect(name).toBeVisible()
			await expect(name).toHaveCSS('text-overflow', 'ellipsis')
			// MDN Element.scrollWidth: wider than clientWidth while the content overflows the element, here the cut text.
			await expect
				.poll(() => name.evaluate(element => element.scrollWidth > element.clientWidth))
				.toBe(true)
			// The left region is the link's parent (Playwright "Other locators": `xpath=..`).
			const region = await home.locator('xpath=..').boundingBox()
			const box = await name.boundingBox()
			expect(region).not.toBeNull()
			expect(box).not.toBeNull()
			expect(box!.x + box!.width).toBeLessThanOrEqual(region!.x + region!.width)
		}
	})
})

test.describe('a user-role account', () => {
	test.use({ storageState: { cookies: [], origins: [] } })
	const emailOf = () => `branding-${test.info().project.name}@e2e.local`

	test.afterEach(async () => {
		await deleteUsersLike(`branding-${test.info().project.name}%`)
	})

	test('is sent away from the settings pages', async ({ page }) => {
		await seedUser({ email: emailOf(), password: 'user-pass-1' })
		await signInAs(page, emailOf(), 'user-pass-1')
		for (const path of ['/settings', '/settings/branding']) {
			await page.goto(path)
			await expect(page).toHaveURL(/\/apps$/)
		}
	})
})
