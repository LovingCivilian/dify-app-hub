import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { logSignInRefusal } from '@/lib/error-log'

describe('logSignInRefusal', () => {
	// B3 spec §7.3: the log carries a fixed reason code, so a subject key of the same name cannot replace it.
	it('logs the fixed reason code over a subject key of the same name', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			logSignInRefusal('authorizeCredentials', 'account_inactive', {
				reason: 'free text',
				userId: 'u1',
			})
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn).toHaveBeenCalledWith('authorizeCredentials: sign-in refused', {
				reason: 'account_inactive',
				userId: 'u1',
			})
		} finally {
			warn.mockRestore()
		}
	})

	// Checked by tsc, which includes this file: the reason is one of the codes in use, not any string (B3b adds its own).
	it('takes only the fixed reason codes', () => {
		expectTypeOf(logSignInRefusal).parameter(1).toEqualTypeOf<'account_inactive'>()
	})
})
