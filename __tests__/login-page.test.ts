import { describe, expect, it, vi } from 'vitest'

const { LoginForm, isMailConfigured } = vi.hoisted(() => ({
	LoginForm: () => null,
	isMailConfigured: vi.fn(() => false),
}))
vi.mock('@/components/auth/login-form', () => ({ default: LoginForm }))
vi.mock('@/lib/mail', () => ({ isMailConfigured }))

import LoginPage from '@/app/(auth)/login/page'

describe('/login page', () => {
	it('hands the form the callbackUrl, the email and the notice from the query', async () => {
		const page = await LoginPage({
			searchParams: Promise.resolve({
				callbackUrl: '/app-management',
				email: 'jane@example.com',
				notice: 'password-changed',
			}),
		})
		expect(page).toMatchObject({
			type: LoginForm,
			props: {
				callbackUrl: '/app-management',
				email: 'jane@example.com',
				notice: 'password-changed',
				mailConfigured: false,
			},
		})
	})

	it('passes nothing for a bare /login', async () => {
		const page = await LoginPage({ searchParams: Promise.resolve({}) })
		expect(page).toMatchObject({
			type: LoginForm,
			props: { callbackUrl: undefined, email: undefined, notice: undefined, mailConfigured: false },
		})
	})

	it('passes only the known notice', async () => {
		const page = await LoginPage({ searchParams: Promise.resolve({ notice: '<script>' }) })
		expect(page).toMatchObject({ props: { notice: undefined } })
	})

	it('tells the form when mail is configured (the forgot-password link shows only then)', async () => {
		isMailConfigured.mockReturnValueOnce(true)
		const page = await LoginPage({ searchParams: Promise.resolve({}) })
		expect(page).toMatchObject({ props: { mailConfigured: true } })
	})
})
