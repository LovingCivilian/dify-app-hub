import { describe, expect, it } from 'vitest'

import { changePasswordFailureKey } from '@/components/shell/account-errors'

describe('changePasswordFailureKey', () => {
	it('maps a lost session to its text and anything else to the generic failure', () => {
		expect(changePasswordFailureKey('unauthorized')).toBe('common.session_expired')
		expect(changePasswordFailureKey('operation_failed')).toBe('account.change_password_failed')
		expect(changePasswordFailureKey('invalid_input')).toBe('account.change_password_failed')
	})
})
