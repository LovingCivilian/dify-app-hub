import { describe, expect, it } from 'vitest'

import { thoughtStatus } from '@/components/chat/message/thought-status'

const done = { observation: '{"ok":true}' }
const open = { observation: '' }

describe('thoughtStatus', () => {
	it('shows the last step of a streaming reply without an observation as running', () => {
		expect(thoughtStatus(open, { last: true, streaming: true })).toBe('loading')
		expect(thoughtStatus(done, { last: true, streaming: true })).toBe('success')
		// An earlier step without an observation finished with none.
		expect(thoughtStatus(open, { last: false, streaming: true })).toBe('success')
	})

	it('shows the unfinished last step of a stopped or failed reply as abort or error', () => {
		expect(thoughtStatus(open, { last: true, streaming: false, interrupted: 'abort' })).toBe(
			'abort',
		)
		expect(thoughtStatus(open, { last: true, streaming: false, interrupted: 'error' })).toBe(
			'error',
		)
		expect(thoughtStatus(done, { last: true, streaming: false, interrupted: 'abort' })).toBe(
			'success',
		)
		expect(thoughtStatus(open, { last: false, streaming: false, interrupted: 'error' })).toBe(
			'success',
		)
	})

	it('shows every step of a reply that ended normally as done', () => {
		expect(thoughtStatus(open, { last: true, streaming: false })).toBe('success')
		expect(thoughtStatus(done, { last: true, streaming: false })).toBe('success')
	})
})
