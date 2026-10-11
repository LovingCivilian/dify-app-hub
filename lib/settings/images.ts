// lib/settings/images.ts
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
	constructor(public readonly code: BrandImageErrorCode) {
		super(code)
		this.name = 'BrandImageError'
	}
}

/** A resource limit in OWASP's sense, tighter than sharp's default `0x3FFF * 0x3FFF` (sharp src/common.h). */
export const MAX_INPUT_PIXELS = 4096 * 4096

/** The decoded formats accepted (spec §4.4 step 3); the browser's declared type is never read. */
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp', 'svg'])

/** The logo at three times its largest display height (64 px) and up to 4:1; the favicon twice the 32 px tab size. */
const BOX: Record<BrandImageKind, { width: number; height: number }> = {
	logo: { width: 768, height: 192 },
	favicon: { width: 64, height: 64 },
}

/** sharp's `density` for vector input: "the DPI … in the range 1 to 100000", default 72. */
const SVG_DENSITY_MAX = 100_000

/**
 * The DPI that draws an SVG (whose size sharp reports at 72 DPI, from width/height or the viewBox) at the box's scale, so a
 * small vector logo is drawn sharp instead of enlarged as pixels.
 */
const svgDensity = (width: number, height: number, box: { width: number; height: number }) =>
	Math.min(Math.max(72 * Math.min(box.width / width, box.height / height), 1), SVG_DENSITY_MAX)

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
	} catch {
		throw new BrandImageError('not_allowed')
	}
	if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height)
		throw new BrandImageError('not_allowed')
	const box = BOX[kind]
	const density = meta.format === 'svg' ? svgDensity(meta.width, meta.height, box) : undefined
	try {
		const { data, info } = await sharp(input, { ...options, density })
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
	} catch {
		throw new BrandImageError('not_allowed')
	}
}
