import { expect, test } from '@playwright/test'

import { e2eEnv } from './fixtures/env'

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
})
