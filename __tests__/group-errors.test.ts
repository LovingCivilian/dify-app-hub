import { describe, expect, it } from 'vitest'

import { groupErrorKey } from '@/components/admin/groups/group-errors'

describe('groupErrorKey', () => {
	it.each([
		['unauthorized', 'common.session_expired'],
		['forbidden', 'common.forbidden'],
		['not_found', 'admin_groups.not_found'],
		['name_in_use', 'admin_groups.name_in_use'],
		['invalid_input', 'admin_groups.invalid_input'],
		['operation_failed', 'common.operation_failed'],
	] as const)('%s → %s', (code, key) => {
		expect(groupErrorKey(code)).toBe(key)
	})
})
