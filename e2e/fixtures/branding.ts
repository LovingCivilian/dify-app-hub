import sharp from 'sharp'

import { withDb } from './db'

/**
 * Back to the built-in brand: the branding row and, through ON DELETE CASCADE, its files. The brand is global state and
 * the suite runs serially (workers: 1), so each branding test ends here (settings spec §8).
 */
export const resetBranding = () =>
	withDb(db => db.execute("DELETE FROM instance_settings WHERE area = 'branding'"))

/** A PNG made on the spot, so the repository holds no binary fixture (sharp constructor, `create`). */
export const pngOf = (width: number, height: number, color = '#1677ff') =>
	sharp({ create: { width, height, channels: 4, background: color } })
		.png()
		.toBuffer()
