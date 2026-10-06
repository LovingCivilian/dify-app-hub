import { describe, expect, it } from 'vitest'

import { initFailureKey, resetFailureKey } from '@/components/auth/auth-failure'

// /api/auth/reset-password answers 400 for a bad, used or expired token (the form already checks length and match).
describe('resetFailureKey', () => {
	it('maps 400 to the expired-link text and anything else to retry', () => {
		expect(resetFailureKey(400)).toBe('auth.reset_link_expired')
		expect(resetFailureKey(500)).toBe('auth.reset_failed_retry')
		expect(resetFailureKey(0)).toBe('auth.reset_failed_retry')
	})
})

// /api/init answers 400 when an admin already exists (the form guarantees the fields).
describe('initFailureKey', () => {
	it('maps 400 to "already set up" and anything else to the generic failure', () => {
		expect(initFailureKey(400)).toBe('init.already_initialized')
		expect(initFailureKey(500)).toBe('init.failed')
	})
})
