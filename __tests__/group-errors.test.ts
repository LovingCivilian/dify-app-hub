import { describe, expect, it } from 'vitest'

import { directorySearchErrorKey, groupErrorKey } from '@/components/admin/groups/group-errors'

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

// The codes GET /api/directory/groups answers in its envelope (decision al); a 409 directory_off, a 500 and a
// failure without an envelope read as the generic failure.
describe('directorySearchErrorKey', () => {
	it.each([
		['unauthorized', 'common.session_expired'],
		['forbidden', 'common.forbidden'],
		['invalid_param', 'admin_groups.invalid_input'],
		['directory_unavailable', 'admin_groups.directory_unavailable'],
		['directory_off', 'common.operation_failed'],
		['internal_error', 'common.operation_failed'],
		[undefined, 'common.operation_failed'],
	] as const)('%s → %s', (code, key) => {
		expect(directorySearchErrorKey(code)).toBe(key)
	})
})
