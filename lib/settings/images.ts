import 'server-only'

import { createHash } from 'node:crypto'

import sharp, { type Metadata } from 'sharp'

import { BRAND_IMAGE_MAX_BYTES, type BrandImageKind } from './branding-rules'
import { APP_ICON_MAX_BYTES, APP_ICON_SIZE, type ImageErrorCode } from './image-rules'

/** An image the hub produced (settings spec §4.4): a PNG, its SHA-256 (hex) and its size in pixels. */
export interface ProcessedImage {
	bytes: Buffer
	sha256: string
	width: number
	height: number
}

/** The images the pipeline takes: the two brand images (ADR-0030) and an app's icon (Part 1 spec §4.4). */
export type ImageKind = BrandImageKind | 'appIcon'

export class ImageError extends Error {
	constructor(
		public readonly code: ImageErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options)
		this.name = 'ImageError'
	}
}

/** A resource limit in OWASP's sense, tighter than sharp's default `0x3FFF * 0x3FFF` (sharp src/common.h). */
export const MAX_INPUT_PIXELS = 4096 * 4096

/**
 * The decoded formats accepted (spec §4.4 step 3); the browser's declared type is never read. SVG is refused (OWASP File
 * Upload Cheat Sheet, "restricted formats", "resource limits"): librsvg, the renderer inside sharp, decodes `data:` rasters
 * itself while it renders, outside `limitInputPixels`, and sharp's `svg.stylesheet` cannot switch them off, because librsvg
 * lets author `!important` rules and `style` attributes override it (`rsvg/src/css.rs:861-867,1051-1059`,
 * `element.rs:430-444`, `properties.rs:946-953`) and cascades a nested `data:` document without it (`document.rs:501,718-726`,
 * librsvg 2.62.0). A 415 KB SVG reached 1.18 GB of memory that way.
 */
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp'])

const MAX_BYTES: Readonly<Record<ImageKind, number>> = {
	...BRAND_IMAGE_MAX_BYTES,
	appIcon: APP_ICON_MAX_BYTES,
}

/**
 * The box each kind is fitted into (sharp `resize`). The logo: three times its largest display height (64 px), up to 4:1,
 * never enlarged. The favicon: twice the 32 px tab size, padded to a square. The app icon: at most 256 px on its longer
 * side, in proportion, never enlarged (Part 1 spec §4.4).
 */
const SHAPE: Readonly<
	Record<
		ImageKind,
		{ width: number; height: number; fit: 'inside' | 'contain'; withoutEnlargement: boolean }
	>
> = {
	logo: { width: 768, height: 192, fit: 'inside', withoutEnlargement: true },
	favicon: { width: 64, height: 64, fit: 'contain', withoutEnlargement: false },
	appIcon: { width: APP_ICON_SIZE, height: APP_ICON_SIZE, fit: 'inside', withoutEnlargement: true },
}

/**
 * Decode, check and re-encode an image as PNG (OWASP File Upload Cheat Sheet: "decode and re-encode to an allowed image
 * format, explicitly removing unnecessary metadata … restricted formats, resource limits"). sharp refuses input on any
 * decoder warning by default (`failOn`), removes metadata from its output by default ("By default all metadata will be
 * removed"), and `autoOrient` applies the EXIF orientation first, so a phone photo stays upright.
 */
export async function processImage(kind: ImageKind, input: Buffer): Promise<ProcessedImage> {
	if (input.length > MAX_BYTES[kind]) throw new ImageError('too_large')
	const options = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true }
	let meta: Metadata
	try {
		meta = await sharp(input, options).metadata()
	} catch (error) {
		throw new ImageError('not_allowed', { cause: error })
	}
	if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height)
		throw new ImageError('not_allowed')
	try {
		const { data, info } = await sharp(input, options)
			.resize({ ...SHAPE[kind], background: { r: 0, g: 0, b: 0, alpha: 0 } })
			.png()
			.toBuffer({ resolveWithObject: true })
		return {
			bytes: data,
			sha256: createHash('sha256').update(data).digest('hex'),
			width: info.width,
			height: info.height,
		}
	} catch (error) {
		throw new ImageError('not_allowed', { cause: error })
	}
}
