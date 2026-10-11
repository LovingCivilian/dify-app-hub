import { describe, expect, it } from 'vitest'

import { isCustomImage, scaledWidth } from '@/components/shell/brand-logo'

describe('scaledWidth (settings spec §4.6: next/image needs both sizes)', () => {
	it('keeps the stored proportions at the display height, never below one pixel', () => {
		expect(scaledWidth({ src: '/x', width: 768, height: 192 }, 28)).toBe(112)
		expect(scaledWidth({ src: '/x', width: 81, height: 83 }, 64)).toBe(62)
		expect(scaledWidth({ src: '/x', width: 1, height: 192 }, 28)).toBe(1)
	})
})

describe('isCustomImage (settings spec §4.6: only a custom image skips the optimizer)', () => {
	it('is true for the two brand routes and false for the built-in static image', () => {
		expect(
			isCustomImage({ src: `/api/branding/logo?v=${'1'.repeat(16)}`, width: 768, height: 192 }),
		).toBe(true)
		expect(
			isCustomImage({ src: `/api/branding/favicon?v=${'2'.repeat(16)}`, width: 64, height: 64 }),
		).toBe(true)
		expect(
			isCustomImage({ src: '/_next/static/media/logo.0a1b2c3d.png', width: 81, height: 83 }),
		).toBe(false)
	})
})
