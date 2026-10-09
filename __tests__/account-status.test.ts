import { describe, expect, it } from 'vitest'

import { isActive } from '@/lib/auth/account-status'

const at = new Date('2026-10-09T10:00:00Z')

describe('isActive (ADR-0027: two independent markers)', () => {
	it('is true only while both markers are empty', () => {
		expect(isActive({ adminDeactivatedAt: null, directoryDeactivatedAt: null })).toBe(true)
		expect(isActive({ adminDeactivatedAt: at, directoryDeactivatedAt: null })).toBe(false)
		expect(isActive({ adminDeactivatedAt: null, directoryDeactivatedAt: at })).toBe(false)
		expect(isActive({ adminDeactivatedAt: at, directoryDeactivatedAt: at })).toBe(false)
	})

	// Decision a: a select that left a marker out must not let the account in.
	it('fails closed on a marker read as undefined', () => {
		expect(isActive({ adminDeactivatedAt: undefined, directoryDeactivatedAt: null } as never)).toBe(
			false,
		)
		expect(isActive({} as never)).toBe(false)
	})
})
