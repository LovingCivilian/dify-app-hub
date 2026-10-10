import { describe, expect, it } from 'vitest'

import { userErrorKey } from '@/components/admin/users/user-errors'

// Charter §4.5: the actions answer codes; the drawer and the table show their translation.
describe('userErrorKey', () => {
	it.each([
		['unauthorized', 'common.session_expired'],
		['forbidden', 'common.forbidden'],
		['not_found', 'admin_users.not_found'],
		['email_in_use', 'admin_users.email_in_use'],
		['cannot_delete_self', 'admin_users.cannot_delete_self'],
		['cannot_deactivate_self', 'admin_users.cannot_deactivate_self'],
		['invalid_input', 'admin_users.invalid_input'],
		['sync_running', 'admin_users.sync_running'],
		['operation_failed', 'common.operation_failed'],
		['dify_unreachable', 'common.operation_failed'],
	] as const)('maps %s to %s', (code, key) => {
		expect(userErrorKey(code)).toBe(key)
	})
})
