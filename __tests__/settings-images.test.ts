// __tests__/settings-images.test.ts
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { BrandImageError, MAX_INPUT_PIXELS, processBrandImage } from '@/lib/settings/images'

const solid = (width: number, height: number) =>
	sharp({ create: { width, height, channels: 4, background: { r: 22, g: 119, b: 255, alpha: 1 } } })

/** The refusal code, or 'accepted'. */
const outcome = async (work: Promise<unknown>) => {
	try {
		await work
		return 'accepted'
	} catch (error) {
		return error instanceof BrandImageError ? error.code : `other: ${String(error)}`
	}
}

describe('processBrandImage (settings spec §4.4)', () => {
	it.each(['png', 'jpeg', 'webp'] as const)(
		're-encodes a %s logo as a PNG inside 768 × 192',
		async format => {
			const out = await processBrandImage('logo', await solid(1600, 400)[format]().toBuffer())
			const meta = await sharp(out.bytes).metadata()
			expect(meta.format).toBe('png')
			expect([out.width, out.height]).toEqual([768, 192])
			expect([meta.width, meta.height]).toEqual([768, 192])
			expect(out.sha256).toMatch(/^[0-9a-f]{64}$/)
		},
	)

	it('does not enlarge a small raster logo', async () => {
		const out = await processBrandImage('logo', await solid(100, 40).png().toBuffer())
		expect([out.width, out.height]).toEqual([100, 40])
	})

	it('draws an SVG wordmark that has only a viewBox at the full box size (Review Focus 2)', async () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100" fill="#1677ff"/></svg>',
		)
		const out = await processBrandImage('logo', svg)
		expect([out.width, out.height]).toEqual([768, 192])
		expect((await sharp(out.bytes).metadata()).format).toBe('png')
	})

	it('turns a favicon into a 64 × 64 PNG with transparent padding', async () => {
		const out = await processBrandImage('favicon', await solid(300, 100).png().toBuffer())
		expect([out.width, out.height]).toEqual([64, 64])
		expect((await sharp(out.bytes).metadata()).hasAlpha).toBe(true)
	})

	it('stores a phone photo upright and without its metadata (Review Focus 3)', async () => {
		// 400 × 200 stored with EXIF orientation 6 is a 200 × 400 picture; inside 768 × 192 that is 96 × 192.
		const input = await solid(400, 200).jpeg().withMetadata({ orientation: 6 }).toBuffer()
		const out = await processBrandImage('logo', input)
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
		expect(await outcome(processBrandImage('logo', input))).toBe('not_allowed')
	})

	it('refuses a GIF, which sharp decodes but the allowlist does not take', async () => {
		expect(await outcome(processBrandImage('favicon', await solid(10, 10).gif().toBuffer()))).toBe(
			'not_allowed',
		)
	})

	it('refuses a truncated PNG whose header still reads', async () => {
		const png = await solid(300, 300).png().toBuffer()
		expect(
			await outcome(processBrandImage('logo', png.subarray(0, Math.floor(png.length / 2)))),
		).toBe('not_allowed')
	})

	it('refuses an image over the pixel limit although its bytes are small (Review Focus 4)', async () => {
		const bomb = await sharp({
			create: { width: 5000, height: 5000, channels: 3, background: 'white' },
		})
			.png({ compressionLevel: 9 })
			.toBuffer()
		expect(bomb.length).toBeLessThan(512 * 1024)
		expect(5000 * 5000).toBeGreaterThan(MAX_INPUT_PIXELS)
		expect(await outcome(processBrandImage('logo', bomb))).toBe('not_allowed')
	})

	it('refuses input over the byte limit of its kind before decoding', async () => {
		expect(await outcome(processBrandImage('favicon', Buffer.alloc(256 * 1024 + 1)))).toBe(
			'too_large',
		)
		expect(await outcome(processBrandImage('logo', Buffer.alloc(512 * 1024 + 1)))).toBe('too_large')
	})
})
