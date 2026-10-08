import { createHash, randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv } from './fixtures/env'

// The reset-token hash as lib/auth/password.ts computes it. That module imports server-only, which Playwright's
// loader cannot resolve, so the spec mirrors the one line instead of importing it.
const hashPasswordResetToken = (token: string) => createHash('sha256').update(token).digest('hex')

test('/ sends a signed-in visitor straight to /apps', async ({ page }) => {
	await page.goto('/')
	await expect(page).toHaveURL(/\/apps$/)
})

test.describe('signed out', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('a wrong password shows the login error and stays on the page', async ({ page }) => {
		await page.goto('/login')
		await page.getByLabel('Email').fill(e2eEnv.E2E_ADMIN_EMAIL)
		await page.getByLabel('Password').fill('not-the-password')
		await page.getByRole('button', { name: 'Log in' }).click()
		await expect(page.getByText('Login failed. Check your email and password.')).toBeVisible()
		await expect(page).toHaveURL(/\/login/)
	})

	test('signing in honours the callbackUrl the proxy added', async ({ page }) => {
		await page.goto('/user-management')
		await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fuser-management$/)
		await page.getByLabel('Email').fill(e2eEnv.E2E_ADMIN_EMAIL)
		await page.getByLabel('Password').fill(e2eEnv.E2E_ADMIN_PASSWORD)
		await page.getByRole('button', { name: 'Log in' }).click()
		await expect(page).toHaveURL(/\/user-management$/)
	})

	test('the login page shows the brand header and a forgot-password link', async ({ page }) => {
		await page.goto('/login')
		await expect(page.getByRole('heading', { name: 'Dify App Hub' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
			'href',
			'/forgot-password',
		)
	})

	test('/init on an initialised instance goes straight to /login', async ({ page }) => {
		// The suite's database holds the admin, so the form never shows (spec §9.6 states the form gap).
		await page.goto('/init')
		await expect(page).toHaveURL(/\/login$/)
	})
})

test.describe('password reset', () => {
	test.use({ storageState: { cookies: [], origins: [] } })

	test('/forgot-password renders its final state in the first paint', async ({ page }) => {
		await page.goto('/forgot-password')
		// .env.e2e decides which: the warning when mail is off, the form when it is on. Exactly one shows.
		const warning = page.getByText('Email service is not configured. Contact your administrator.')
		const form = page.getByLabel('Email')
		await expect(warning.or(form)).toBeVisible()
		expect((await warning.count()) + (await form.count())).toBe(1)
	})

	test('/reset-password without a token shows the invalid-link result', async ({ page }) => {
		await page.goto('/reset-password')
		await expect(page.getByText('This reset link is invalid')).toBeVisible()
		await expect(page.getByRole('link', { name: 'Back to login' })).toBeVisible()
	})

	test('a valid token sets a new password once; reusing it says the link expired', async ({
		page,
		request,
		browser,
	}, testInfo) => {
		const email = `reset-${testInfo.project.name}@e2e.local`
		const token = randomUUID().replaceAll('-', '')
		// A throwaway user through the signed-in API (admin storage state), then the token row as the route
		// would store it (lib/auth/password.ts: sha-256 hash, 15-minute expiry).
		const admin = await browser.newContext({ storageState: ADMIN_STATE })
		await admin.request.post('/api/users', {
			data: { name: 'Reset me', email, password: 'old-password-1' },
		})
		await admin.close()
		const userId = await withDb(async db => {
			const [rows] = await db.execute('SELECT id FROM users WHERE email = ?', [email])
			const id = (rows as { id: string }[])[0].id
			await db.execute(
				'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL 15 MINUTE), NOW(3))',
				[randomUUID(), id, hashPasswordResetToken(token)],
			)
			return id
		})
		try {
			await page.goto(`/reset-password?token=${token}`)
			await page.getByLabel('New password').fill('new-password-1')
			await page.getByLabel('Confirm password').fill('new-password-1')
			await page.getByRole('button', { name: 'Reset password' }).click()
			await expect(page).toHaveURL(/\/login$/)

			await page.getByLabel('Email').fill(email)
			await page.getByLabel('Password').fill('new-password-1')
			await page.getByRole('button', { name: 'Log in' }).click()
			await expect(page).toHaveURL(/\/apps$/)

			const reuse = await request.post('/api/auth/reset-password', {
				data: { token, password: 'another-pass-1', confirmPassword: 'another-pass-1' },
			})
			expect(reuse.status()).toBe(400)
			await page.context().clearCookies()
			await page.goto(`/reset-password?token=${token}`)
			await page.getByLabel('New password').fill('another-pass-1')
			await page.getByLabel('Confirm password').fill('another-pass-1')
			await page.getByRole('button', { name: 'Reset password' }).click()
			await expect(page.getByText('This reset link is invalid or has expired.')).toBeVisible()
			await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible()
		} finally {
			await withDb(async db => {
				await db.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId])
				await db.execute('DELETE FROM users WHERE id = ?', [userId])
			})
		}
	})
})
