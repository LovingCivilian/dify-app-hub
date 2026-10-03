// __tests__/account-menu.test.ts
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { getAccountMenuItems } from '@/components/auth/account-menu'

// A stand-in for i18next's t that makes the key and options visible in the output.
const t = ((key: string, options?: Record<string, string>) =>
	options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction

describe('getAccountMenuItems', () => {
	it('shows the signed-in email as a disabled line and a logout action', () => {
		const onLogout = vi.fn()
		const items = getAccountMenuItems({ email: 'jane@example.com', t, onLogout })

		expect(items).toHaveLength(2)
		expect(items[0]).toMatchObject({
			key: 'account',
			disabled: true,
			label: 'auth.signed_in_as:{"email":"jane@example.com"}',
		})
		expect(items[1]).toMatchObject({ key: 'logout', label: 'auth.logout' })
		;(items[1] as unknown as { onClick: () => void }).onClick()
		expect(onLogout).toHaveBeenCalledTimes(1)
	})
})
