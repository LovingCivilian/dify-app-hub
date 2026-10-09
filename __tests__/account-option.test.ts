import { describe, expect, it } from 'vitest'

import { accountOptionLabel } from '@/components/admin/account-option'

describe('accountOptionLabel (decision e)', () => {
	it('shows the name with the email, the email alone without a name, and tags a deactivated account', () => {
		expect(
			accountOptionLabel(
				{ id: 'u1', name: 'Jane', email: 'jane@x.io', active: true },
				'Deactivated',
			),
		).toBe('Jane (jane@x.io)')
		expect(
			accountOptionLabel({ id: 'u2', name: null, email: 'joe@x.io', active: true }, 'Deactivated'),
		).toBe('joe@x.io')
		expect(
			accountOptionLabel(
				{ id: 'u3', name: 'Ann', email: 'ann@x.io', active: false },
				'Deactivated',
			),
		).toBe('Ann (ann@x.io) · Deactivated')
	})
})
