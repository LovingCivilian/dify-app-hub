import { expect, test as setup } from '@playwright/test'
import mysql from 'mysql2/promise'

import { ADMIN_STATE, STUB_APPS } from './fixtures/constants'
import { e2eEnv, stubApiBase } from './fixtures/env'

setup('initialise the admin, seed the stub apps, sign in', async ({ page, request }) => {
	// POST /api/init creates the first admin; 400 means the database already has one (server reused).
	const init = await request.post('/api/init', {
		data: { name: 'E2E Admin', email: e2eEnv.E2E_ADMIN_EMAIL, password: e2eEnv.E2E_ADMIN_PASSWORD },
	})
	expect([200, 201, 400]).toContain(init.status())

	const db = await mysql.createConnection(e2eEnv.DATABASE_URL)
	for (const app of STUB_APPS) {
		// A database that survives between runs keeps its rows: the display mode and the annotation switch
		// are refreshed on them.
		await db.execute(
			'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode, enable_annotation) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE opening_statement_display_mode = ?, enable_annotation = ?',
			[
				app.id,
				app.name,
				app.mode,
				'Seeded for the e2e suite',
				`${stubApiBase}${app.prefix}`,
				'app-e2e',
				app.openingStatementDisplayMode,
				app.enableAnnotation,
				app.openingStatementDisplayMode,
				app.enableAnnotation,
			],
		)
	}
	await db.end()

	await page.goto('/login')
	// The login form's inputs have no <label>; the documented locator for that case is the placeholder.
	await page.getByPlaceholder('Email address').fill(e2eEnv.E2E_ADMIN_EMAIL)
	await page.getByPlaceholder('Password').fill(e2eEnv.E2E_ADMIN_PASSWORD)
	await page.getByRole('button', { name: 'Log in' }).click()
	await expect(page).toHaveURL(/\/apps$/)
	await page.context().storageState({ path: ADMIN_STATE })
})
