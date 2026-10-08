import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { getAccountMenuItems } from '@/components/shell/account-dropdown'
import { logout, signOutAfterPasswordChange } from '@/components/shell/sign-out'

// next-auth's client is mocked: the test checks what the sign-outs ask of it, not the request they make.
vi.mock('next-auth/react', () => ({ signOut: vi.fn(), useSession: vi.fn() }))
// The modal reaches a Server Action and the DAL; the menu test needs neither.
vi.mock('@/components/shell/change-password-modal', () => ({ default: () => null }))
const { signOut } = await import('next-auth/react')

// A stand-in for i18next's t that makes the key and options visible in the output.
const t = ((key: string, options?: Record<string, string>) =>
	options ? `${key}:${JSON.stringify(options)}` : key) as unknown as TFunction

describe('getAccountMenuItems', () => {
	it('shows the signed-in email, then change password, then log out', () => {
		const onChangePassword = vi.fn()
		const onLogout = vi.fn()
		const items = getAccountMenuItems({ email: 'jane@example.com', t, onChangePassword, onLogout })
		expect(items.map(item => item?.key)).toEqual(['account', 'change-password', 'logout'])
		expect(items[0]).toMatchObject({
			disabled: true,
			label: 'auth.signed_in_as:{"email":"jane@example.com"}',
		})
		expect(items[1]).toMatchObject({ label: 'account.change_password' })
		;(items[1] as unknown as { onClick: () => void }).onClick()
		;(items[2] as unknown as { onClick: () => void }).onClick()
		expect(onChangePassword).toHaveBeenCalledTimes(1)
		expect(onLogout).toHaveBeenCalledTimes(1)
	})
})

describe('sign-outs', () => {
	// next-auth client API, signOut(): without `redirect: false` it sets window.location.href to the callback URL,
	// a full page load, so module state of the signed-out user does not outlive the session.
	it('logs out with a full page load to the login page', async () => {
		await logout()
		expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
	})

	it('after a password change, lands on the login page with the notice (charter §4.2)', async () => {
		await signOutAfterPasswordChange()
		expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login?notice=password-changed' })
	})
})
