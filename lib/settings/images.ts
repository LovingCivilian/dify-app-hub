import 'server-only'

import { createHash } from 'node:crypto'

import sharp, { type Metadata } from 'sharp'

import {
	BRAND_IMAGE_MAX_BYTES,
	type BrandImageErrorCode,
	type BrandImageKind,
} from './branding-rules'

/** An image the hub produced (settings spec §4.4): a PNG, its SHA-256 (hex) and its size in pixels. */
export interface ProcessedImage {
	bytes: Buffer
	sha256: string
	width: number
	height: number
}

export class BrandImageError extends Error {
	constructor(
		public readonly code: BrandImageErrorCode,
		options?: ErrorOptions,
	) {
		super(code, options)
		this.name = 'BrandImageError'
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

/** The logo at three times its largest display height (64 px) and up to 4:1; the favicon twice the 32 px tab size. */
const BOX: Record<BrandImageKind, { width: number; height: number }> = {
	logo: { width: 768, height: 192 },
	favicon: { width: 64, height: 64 },
}

/**
 * Decode, check and re-encode an image as PNG (OWASP File Upload Cheat Sheet: "decode and re-encode to an allowed image
 * format, explicitly removing unnecessary metadata … restricted formats, resource limits"). sharp refuses input on any
 * decoder warning by default (`failOn`), removes metadata from its output by default ("By default all metadata will be
 * removed"), and `autoOrient` applies the EXIF orientation first, so a phone photo stays upright.
 */
export async function processBrandImage(
	kind: BrandImageKind,
	input: Buffer,
): Promise<ProcessedImage> {
	if (input.length > BRAND_IMAGE_MAX_BYTES[kind]) throw new BrandImageError('too_large')
	const options = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true }
	let meta: Metadata
	try {
		meta = await sharp(input, options).metadata()
	} catch (error) {
		throw new BrandImageError('not_allowed', { cause: error })
	}
	if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height)
		throw new BrandImageError('not_allowed')
	const box = BOX[kind]
	try {
		const { data, info } = await sharp(input, options)
			.resize({
				...box,
				fit: kind === 'logo' ? 'inside' : 'contain',
				withoutEnlargement: kind === 'logo',
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			})
			.png()
			.toBuffer({ resolveWithObject: true })
		return {
			bytes: data,
			sha256: createHash('sha256').update(data).digest('hex'),
			width: info.width,
			height: info.height,
		}
	} catch (error) {
		throw new BrandImageError('not_allowed', { cause: error })
	}
}
