import { describe, expect, it } from 'vitest'

import { MARKDOWN_SAMPLES } from '@/e2e/fixtures/markdown-samples'

describe('markdown samples', () => {
	it('cover every spike criterion', () => {
		expect(Object.keys(MARKDOWN_SAMPLES).sort()).toEqual(
			['code', 'html', 'imageFirst', 'links', 'long', 'math', 'streaming', 'theme', 'think'].sort(),
		)
	})
	it('carry a video given by <source> children as well as one with a src', () => {
		expect(MARKDOWN_SAMPLES.html).toMatch(/<video src="[^"]+"><\/video>/)
		expect(MARKDOWN_SAMPLES.html).toMatch(/<video><source src="[^"]+"[^>]*\/><\/video>/)
	})
	it('keep the html sample within the tags the sanitizer allows', () => {
		const tags = [...MARKDOWN_SAMPLES.html.matchAll(/<([a-z]+)[\s>/]/g)].map(m => m[1])
		expect(tags.length).toBeGreaterThan(0)
		for (const tag of tags) {
			expect([
				'img',
				'video',
				'source',
				'form',
				'label',
				'input',
				'textarea',
				'button',
				'details',
				'summary',
			]).toContain(tag)
		}
	})
})
