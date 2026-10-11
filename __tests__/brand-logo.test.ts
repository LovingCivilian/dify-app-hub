import { describe, expect, it } from 'vitest'

import { scaledWidth } from '@/components/shell/brand-logo'

describe('scaledWidth (settings spec §4.6: next/image needs both sizes)', () => {
	it('keeps the stored proportions at the display height, never below one pixel', () => {
		expect(scaledWidth({ src: '/x', width: 768, height: 192 }, 28)).toBe(112)
		expect(scaledWidth({ src: '/x', width: 81, height: 83 }, 64)).toBe(62)
		expect(scaledWidth({ src: '/x', width: 1, height: 192 }, 28)).toBe(1)
	})
})
