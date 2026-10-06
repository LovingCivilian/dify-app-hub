import { describe, expect, it } from 'vitest'

import { userErrorKey } from '@/components/admin/users/user-errors'

// The /api/users routes answer in Chinese (spec §3.6); the client maps the status instead of printing the text.
describe('userErrorKey', () => {
	it('maps the documented statuses of each action', () => {
		expect(userErrorKey(400, 'create')).toBe('admin_users.email_in_use')
		expect(userErrorKey(400, 'update')).toBe('admin_users.email_in_use')
		expect(userErrorKey(400, 'delete')).toBe('admin_users.cannot_delete_self')
		expect(userErrorKey(404, 'update')).toBe('admin_users.not_found')
		expect(userErrorKey(404, 'delete')).toBe('admin_users.not_found')
		expect(userErrorKey(401, 'create')).toBe('common.session_expired')
	})

	it('falls back to the generic failure', () => {
		expect(userErrorKey(500, 'create')).toBe('common.operation_failed')
		expect(userErrorKey(418, 'delete')).toBe('common.operation_failed')
	})
})
