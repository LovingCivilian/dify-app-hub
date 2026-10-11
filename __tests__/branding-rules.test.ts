import { describe, expect, it } from 'vitest'

import { brandNameSchema, effectiveShowName, shellBranding } from '@/lib/settings/branding-rules'

describe('brandNameSchema (settings spec §4.1)', () => {
	it('trims and accepts 1–64 characters, counted as code points', () => {
		expect(brandNameSchema.parse('  Acme AI Hub  ')).toBe('Acme AI Hub')
		expect(brandNameSchema.safeParse('   ').success).toBe(false)
		expect(brandNameSchema.safeParse('a'.repeat(65)).success).toBe(false)
		// 64 emoji are 128 UTF-16 code units and 64 code points (zod 4 counts code points).
		expect(brandNameSchema.safeParse('🚀'.repeat(64)).success).toBe(true)
	})
})

describe('effectiveShowName (spec §4.2: the header is never empty)', () => {
	it('shows the name when asked, and always when there is no logo', () => {
		expect(effectiveShowName(true, true)).toBe(true)
		expect(effectiveShowName(false, true)).toBe(false)
		expect(effectiveShowName(false, false)).toBe(true)
		expect(effectiveShowName(true, false)).toBe(true)
	})
})

describe('shellBranding (spec §4.6, ADR-0020: the client context gets the name, showName and the logo only)', () => {
	it('leaves the favicon URL on the server, where generateMetadata uses it', () => {
		const logo = { src: `/api/branding/logo?v=${'1'.repeat(16)}`, width: 768, height: 192 }
		expect(
			shellBranding({
				name: 'Acme',
				showName: false,
				logo,
				faviconSrc: `/api/branding/favicon?v=${'2'.repeat(16)}`,
			}),
		).toStrictEqual({ name: 'Acme', showName: false, logo })
	})
})
