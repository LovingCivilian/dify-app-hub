// __tests__/account-menu.test.ts
import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { getAccountMenuItems, logout } from '@/components/shell/account-dropdown'

// next-auth's client is mocked: the test checks what logout asks of it, not the request it makes.
vi.mock('next-auth/react', () => ({ signOut: vi.fn(), useSession: vi.fn() }))
const { signOut } = await import('next-auth/react')

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

describe('logout', () => {
	// next-auth client API, signOut(): without `redirect: false` it sets window.location.href to the
	// callback URL, a full page load, so module state of the signed-out user does not outlive the session.
	it('signs out with a full page load to the login page', async () => {
		await logout()
		expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
	})
})
