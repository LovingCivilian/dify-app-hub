import { describe, expect, it } from 'vitest'

import { applyHtmlLang } from '@/hooks/use-html-lang'

describe('applyHtmlLang', () => {
	it('sets the lang attribute to the active language', () => {
		const html = { lang: 'en' }
		applyHtmlLang(html, 'ar')
		expect(html.lang).toBe('ar')
	})

	it('leaves the attribute alone while the language is still unknown', () => {
		const html = { lang: 'en' }
		applyHtmlLang(html, undefined)
		expect(html.lang).toBe('en')
	})
})
