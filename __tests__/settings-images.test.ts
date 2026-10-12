import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { APP_ICON_MAX_BYTES, APP_ICON_SIZE, IMAGE_MIME_TYPES } from '@/lib/settings/image-rules'
import { ImageError, MAX_INPUT_PIXELS, processImage } from '@/lib/settings/images'

const solid = (width: number, height: number) =>
	sharp({ create: { width, height, channels: 4, background: { r: 22, g: 119, b: 255, alpha: 1 } } })

/** The refusal code, or 'accepted'. */
const outcome = async (work: Promise<unknown>) => {
	try {
		await work
		return 'accepted'
	} catch (error) {
		return error instanceof ImageError ? error.code : `other: ${String(error)}`
	}
}

describe('processImage (settings spec §4.4)', () => {
	it.each(['png', 'jpeg', 'webp'] as const)(
		're-encodes a %s logo as a PNG inside 768 × 192',
		async format => {
			const out = await processImage('logo', await solid(1600, 400)[format]().toBuffer())
			const meta = await sharp(out.bytes).metadata()
			expect(meta.format).toBe('png')
			expect([out.width, out.height]).toEqual([768, 192])
			expect([meta.width, meta.height]).toEqual([768, 192])
			expect(out.sha256).toMatch(/^[0-9a-f]{64}$/)
		},
	)

	it('does not enlarge a small raster logo', async () => {
		const out = await processImage('logo', await solid(100, 40).png().toBuffer())
		expect([out.width, out.height]).toEqual([100, 40])
	})

	it('turns a favicon into a 64 × 64 PNG with transparent padding', async () => {
		const out = await processImage('favicon', await solid(300, 100).png().toBuffer())
		expect([out.width, out.height]).toEqual([64, 64])
		// 300 × 100 contained in 64 × 64 is 64 × 21: the first row is padding, the middle row is the picture.
		const { data } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true })
		const alphaAt = (row: number) => data[(row * 64 + 32) * 4 + 3]
		expect(alphaAt(0)).toBe(0)
		expect(alphaAt(32)).toBe(255)
	})

	it('stores a phone photo upright and without its metadata (Review Focus 3)', async () => {
		// 400 × 200 stored with EXIF orientation 6 is a 200 × 400 picture; inside 768 × 192 that is 96 × 192.
		const input = await solid(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer()
		const out = await processImage('logo', input)
		expect([out.width, out.height]).toEqual([96, 192])
		const meta = await sharp(out.bytes).metadata()
		expect(meta.exif).toBeUndefined()
		expect(meta.orientation).toBeUndefined()
	})

	it.each([
		[
			'an ICO file',
			Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0]), Buffer.alloc(64)]),
		],
		['a text file', Buffer.from('not an image')],
		['an empty file', Buffer.alloc(0)],
	])('refuses %s as not_allowed', async (_name, input) => {
		expect(await outcome(processImage('logo', input))).toBe('not_allowed')
	})

	it('refuses a GIF, which sharp decodes but the allowlist does not take', async () => {
		expect(await outcome(processImage('favicon', await solid(10, 10).gif().toBuffer()))).toBe(
			'not_allowed',
		)
	})

	it('refuses a truncated PNG whose header still reads', async () => {
		const png = await solid(300, 300).png().toBuffer()
		expect(await outcome(processImage('logo', png.subarray(0, Math.floor(png.length / 2))))).toBe(
			'not_allowed',
		)
	})

	it('refuses an image over the pixel limit although its bytes are small (Review Focus 4)', async () => {
		const bomb = await sharp({
			create: { width: 5000, height: 5000, channels: 3, background: 'white' },
		})
			.png({ compressionLevel: 9 })
			.toBuffer()
		expect(bomb.length).toBeLessThan(512 * 1024)
		expect(5000 * 5000).toBeGreaterThan(MAX_INPUT_PIXELS)
		expect(await outcome(processImage('logo', bomb))).toBe('not_allowed')
	})

	describe('refuses SVG, which librsvg renders outside the pixel limit (OWASP restricted formats)', () => {
		const bombHref = async () =>
			`data:image/png;base64,${(
				await sharp({ create: { width: 5000, height: 5000, channels: 3, background: 'white' } })
					.png({ compressionLevel: 9 })
					.toBuffer()
			).toString('base64')}`
		const svgOf = (body: string) =>
			Buffer.from(
				`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 100">${body}</svg>`,
			)

		it.each([
			[
				'a viewBox-only wordmark',
				async () => svgOf('<rect width="400" height="100" fill="#1677ff"/>'),
			],
			[
				'a large coordinate system',
				async () =>
					Buffer.from(
						'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 2500"><rect width="10000" height="2500"/></svg>',
					),
			],
			[
				'an <image> with a data: URL',
				async () => svgOf(`<image width="400" height="100" href="${await bombHref()}"/>`),
			],
			[
				'an <image> forced visible by a style attribute',
				async () =>
					svgOf(
						`<image style="display:inline !important" width="400" height="100" href="${await bombHref()}"/>`,
					),
			],
			[
				'an <image> forced visible by an author <style>',
				async () =>
					svgOf(
						`<style>#i { display: inline !important }</style><image id="i" width="400" height="100" href="${await bombHref()}"/>`,
					),
			],
			[
				'an <feImage> filter',
				async () =>
					svgOf(
						`<filter id="f"><feImage href="${await bombHref()}"/></filter><rect width="400" height="100" fill="none" filter="url(#f)"/>`,
					),
			],
			[
				'a <use> of a nested data: SVG',
				async () => {
					const nested = Buffer.from(
						`<svg xmlns="http://www.w3.org/2000/svg" id="x"><image width="400" height="100" href="${await bombHref()}"/></svg>`,
					).toString('base64')
					return svgOf(`<use href="data:image/svg+xml;base64,${nested}#x"/>`)
				},
			],
			[
				'a file: reference',
				async () => svgOf('<image width="400" height="100" href="file:///etc/hostname"/>'),
			],
			[
				'an external entity',
				async () =>
					Buffer.from(
						'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY w SYSTEM "file:///etc/hostname">]><svg xmlns="http://www.w3.org/2000/svg" width="&w;" height="100"><rect width="10" height="10"/></svg>',
					),
			],
		])('refuses %s as not_allowed', async (_name, make) => {
			expect(await outcome(processImage('logo', await make()))).toBe('not_allowed')
		})
	})

	it('refuses input over the byte limit of its kind before decoding', async () => {
		expect(await outcome(processImage('favicon', Buffer.alloc(256 * 1024 + 1)))).toBe('too_large')
		expect(await outcome(processImage('logo', Buffer.alloc(512 * 1024 + 1)))).toBe('too_large')
	})
})

// Part 1 spec §4.4: the app icon is a third kind of the same pipeline.
describe('processImage for an app icon (Part 1 spec §4.4)', () => {
	it('keeps the limits the spec sets: PNG, JPEG or WebP, 256 px, a 512 KB input (owner, 2026-10-12)', () => {
		expect(IMAGE_MIME_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp'])
		expect(APP_ICON_SIZE).toBe(256)
		expect(APP_ICON_MAX_BYTES).toBe(512 * 1024)
	})

	it.each(['png', 'jpeg', 'webp'] as const)(
		're-encodes a %s icon as a PNG inside 256 × 256, in proportion',
		async format => {
			const out = await processImage('appIcon', await solid(1024, 512)[format]().toBuffer())
			const meta = await sharp(out.bytes).metadata()
			expect(meta.format).toBe('png')
			expect([out.width, out.height]).toEqual([256, 128])
			expect([meta.width, meta.height]).toEqual([256, 128])
		},
	)

	it('does not enlarge a small icon', async () => {
		const out = await processImage('appIcon', await solid(64, 64).png().toBuffer())
		expect([out.width, out.height]).toEqual([64, 64])
	})

	it('refuses an SVG icon as not_allowed', async () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>',
		)
		expect(await outcome(processImage('appIcon', svg))).toBe('not_allowed')
	})

	it('refuses an icon over its byte limit before decoding', async () => {
		expect(await outcome(processImage('appIcon', Buffer.alloc(APP_ICON_MAX_BYTES + 1)))).toBe(
			'too_large',
		)
	})
})
