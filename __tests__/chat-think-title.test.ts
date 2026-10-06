import { describe, expect, it } from 'vitest'

import { thinkTitle } from '@/components/chat/message/think-title'
import i18n from '@/libs/i18n'

describe('thinkTitle', () => {
	const en = i18n.getFixedT('en')

	it('shows the running time while the block streams, zero before the first tick', () => {
		expect(thinkTitle(en, true, 1.25, 'en')).toBe('Thinking... (1.3s)')
		expect(thinkTitle(en, true, undefined, 'en')).toBe('Thinking... (0.0s)')
	})

	it('shows the time it took once done, or the bare text when no time is known', () => {
		expect(thinkTitle(en, false, 3, 'en')).toBe('Finished thinking (3.0s)')
		expect(thinkTitle(en, false, 0, 'en')).toBe('Finished thinking (0.0s)')
		expect(thinkTitle(en, false, undefined, 'en')).toBe('Finished thinking')
	})

	it('writes the seconds in the UI language digits (ADR-0005)', () => {
		expect(thinkTitle(i18n.getFixedT('ar'), false, 2.5, 'ar')).toBe('انتهى التفكير (٢٫٥ ث)')
	})
})
