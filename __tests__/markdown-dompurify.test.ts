import { describe, expect, it } from 'vitest'

import {
	difyDompurifyConfig,
	formFieldName,
} from '@/components/chat/message/markdown/dompurify-config'

// The config extends DOMPurify's defaults (ADD_TAGS/ADD_ATTR) instead of replacing them, so the Latex plugin's
// KaTeX HTML output and GFM task-list inputs keep rendering while Dify's custom tags are allowed.
describe('difyDompurifyConfig', () => {
	it('extends rather than replaces the default allow lists', () => {
		expect(difyDompurifyConfig).not.toHaveProperty('ALLOWED_TAGS')
		expect(difyDompurifyConfig).not.toHaveProperty('ALLOWED_ATTR')
	})
	it('allows the think tag and the attributes Dify answers rely on', () => {
		expect(difyDompurifyConfig.ADD_TAGS).toEqual(expect.arrayContaining(['think']))
		expect(difyDompurifyConfig.ADD_ATTR).toEqual(expect.arrayContaining(['target', 'controls']))
	})
	// With the default protection alone DOMPurify drops a field such as <input name="name"> ("name" is a form
	// property); namespace isolation keeps every id/name, prefixed, and DOM clobbering stays blocked.
	it('isolates id and name attributes instead of dropping the ones that would clobber', () => {
		expect(difyDompurifyConfig.SANITIZE_NAMED_PROPS).toBe(true)
		expect(difyDompurifyConfig).not.toHaveProperty('SANITIZE_DOM')
	})
})

describe('formFieldName', () => {
	it('recovers the name Dify gave a field from the isolated attribute', () => {
		expect(formFieldName('user-content-name')).toBe('name')
		expect(formFieldName('user-content-user-content-x')).toBe('user-content-x')
	})
	it('leaves a name without the prefix as it is and reports a missing one', () => {
		expect(formFieldName('notes')).toBe('notes')
		expect(formFieldName(undefined)).toBeUndefined()
	})
})
