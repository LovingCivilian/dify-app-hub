import { expect, type Page } from '@playwright/test'
import sharp from 'sharp'

import { withDb } from './db'

/**
 * Back to the built-in brand: the branding row and, through ON DELETE CASCADE, its files (MySQL 8.4 "FOREIGN KEY
 * Constraints", `CASCADE`: "Delete or update the row from the parent table and automatically delete or update the
 * matching rows in the child table"). The brand is global state and the suite runs serially (workers: 1), so each
 * branding test ends here (settings spec §8).
 */
export const resetBranding = () =>
	withDb(db => db.execute("DELETE FROM instance_settings WHERE area = 'branding'"))

/** A PNG made on the spot, so the repository holds no binary fixture (sharp constructor, `create`). */
export const pngOf = (width: number, height: number, color = '#1677ff') =>
	sharp({ create: { width, height, channels: 4, background: color } })
		.png()
		.toBuffer()

/**
 * The screenshots' demo logo, 400 × 100 without text: a rounded bar in antd's primary blue with a white disc and two
 * white strokes. Drawn as SVG and rendered by sharp, which turns SVG input into PNG output (sharp `toBuffer`); the hub
 * only ever receives the PNG.
 */
export const demoLogo = () =>
	sharp(
		Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100">' +
				'<rect width="400" height="100" rx="24" fill="#1677ff"/>' +
				'<circle cx="52" cy="50" r="28" fill="#ffffff"/>' +
				'<rect x="104" y="30" width="232" height="14" rx="7" fill="#ffffff"/>' +
				'<rect x="104" y="56" width="152" height="14" rx="7" fill="#ffffff" fill-opacity="0.6"/>' +
				'</svg>',
		),
	)
		.png()
		.toBuffer()

/**
 * Chooses a file through an Upload button (Playwright "File chooser": wait for the event, click). A click before
 * hydration opens no chooser, so the pair is retried (Playwright `expect.toPass`; it "defaults to a timeout of 0 and
 * does not respect custom expect timeouts", so it is given one, as e2e/fixtures/users.ts does). The event and the click
 * start together under `Promise.all`, which handles both promises (MDN `Promise.all`: it rejects with the first
 * rejection), so a click that outlasts the event's timeout fails this attempt instead of the test; the click has its
 * own timeout (Playwright `locator.click` `timeout`) for the same reason.
 */
export const chooseFile = async (
	page: Page,
	button: string,
	file: { name: string; mimeType: string; buffer: Buffer },
) => {
	await expect(async () => {
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser', { timeout: 2_000 }),
			page.getByRole('button', { name: button }).click({ timeout: 2_000 }),
		])
		await chooser.setFiles(file)
	}).toPass({ timeout: 30_000 })
}
