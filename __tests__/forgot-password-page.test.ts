import { describe, expect, it, vi } from 'vitest'

const { isMailConfigured, ForgotPasswordForm } = vi.hoisted(() => ({
	isMailConfigured: vi.fn(),
	ForgotPasswordForm: () => null,
}))
vi.mock('@/lib/mail', () => ({ isMailConfigured }))
vi.mock('@/components/auth/forgot-password-form', () => ({ default: ForgotPasswordForm }))

import ForgotPasswordPage from '@/app/(auth)/forgot-password/page'

describe('/forgot-password page', () => {
	it('tells the form on the server whether mail is configured, so the first HTML is final', async () => {
		isMailConfigured.mockReturnValue(false)
		expect(await ForgotPasswordPage()).toMatchObject({
			type: ForgotPasswordForm,
			props: { mailConfigured: false },
		})
		isMailConfigured.mockReturnValue(true)
		expect(await ForgotPasswordPage()).toMatchObject({ props: { mailConfigured: true } })
	})
})
