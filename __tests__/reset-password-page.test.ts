import { describe, expect, it, vi } from 'vitest'

const { ResetPasswordForm } = vi.hoisted(() => ({ ResetPasswordForm: () => null }))
vi.mock('@/components/auth/reset-password-form', () => ({ default: ResetPasswordForm }))

import ResetPasswordPage from '@/app/(auth)/reset-password/page'

describe('/reset-password page', () => {
	it('reads the token on the server', async () => {
		expect(
			await ResetPasswordPage({ searchParams: Promise.resolve({ token: 'abc' }) }),
		).toMatchObject({
			type: ResetPasswordForm,
			props: { token: 'abc' },
		})
		expect(await ResetPasswordPage({ searchParams: Promise.resolve({}) })).toMatchObject({
			props: { token: undefined },
		})
	})
})
