import { describe, expect, it, vi } from 'vitest'

const { LoginForm } = vi.hoisted(() => ({ LoginForm: () => null }))
vi.mock('@/components/auth/login-form', () => ({ default: LoginForm }))

import LoginPage from '@/app/(auth)/login/page'

describe('/login page', () => {
	it('hands the form the callbackUrl and the email from the query', async () => {
		const page = await LoginPage({
			searchParams: Promise.resolve({ callbackUrl: '/app-management', email: 'jane@example.com' }),
		})
		expect(page).toMatchObject({
			type: LoginForm,
			props: { callbackUrl: '/app-management', email: 'jane@example.com' },
		})
	})

	it('passes nothing for a bare /login', async () => {
		const page = await LoginPage({ searchParams: Promise.resolve({}) })
		expect(page).toMatchObject({
			type: LoginForm,
			props: { callbackUrl: undefined, email: undefined },
		})
	})
})
