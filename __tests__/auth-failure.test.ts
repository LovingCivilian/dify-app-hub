import { describe, expect, it } from 'vitest'

import { initFailureKey, loginFailureKey, resetFailureKey } from '@/components/auth/auth-failure'

// /api/auth/reset-password answers 400 for a bad, used or expired token (the form already checks length and match).
describe('resetFailureKey', () => {
	it('maps 400 to the expired-link text and anything else to retry', () => {
		expect(resetFailureKey(400)).toBe('auth.reset_link_expired')
		expect(resetFailureKey(500)).toBe('auth.reset_failed_retry')
		expect(resetFailureKey(0)).toBe('auth.reset_failed_retry')
	})
})

// The first-run action answers forbidden once any account exists (Review Focus 5).
describe('initFailureKey', () => {
	it('maps the action codes', () => {
		expect(initFailureKey('forbidden')).toBe('init.already_initialized')
		expect(initFailureKey('operation_failed')).toBe('init.failed')
		expect(initFailureKey('invalid_input')).toBe('init.failed')
	})
})

// next-auth answers CredentialsSignin when authorize() returned null, a wrong email or password (next-auth Pages,
// "Error codes"); a thrown Error arrives as its own message (lib/auth/options.ts throws next-auth's `Default`).
describe('loginFailureKey', () => {
	it('shows "check your email and password" only for a refused credential', () => {
		expect(loginFailureKey('CredentialsSignin')).toBe('auth.login_failed')
		expect(loginFailureKey('Default')).toBe('auth.login_error')
		expect(loginFailureKey('Configuration')).toBe('auth.login_error')
	})
})
