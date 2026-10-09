import { expect, test as setup } from '@playwright/test'
import mysql from 'mysql2/promise'

import { ADMIN_STATE, SEEDED_EXTRA_APPS, STUB_APPS } from './fixtures/constants'
import { e2eEnv, stubApiBase } from './fixtures/env'
import { signInAs } from './fixtures/users'

setup(
	'set up the owner through /init when needed, seed the stub apps, sign in',
	async ({ page }) => {
		// Charter §4.2 and §4.6: on an empty database the login layout sends the browser to /init, where the form
		// creates the owner (ADR-0024); on a set-up one the browser stays on /login. The layout redirects before
		// anything streams, so goto follows a 307 and the URL tells which path this run took; the annotation records
		// it (the final full run starts empty).
		await page.goto('/login')
		if (new URL(page.url()).pathname === '/init') {
			await page.getByLabel('Owner name').fill('E2E Owner')
			await page.getByLabel('Owner email').fill(e2eEnv.E2E_ADMIN_EMAIL)
			await page.getByLabel('Owner password').fill(e2eEnv.E2E_ADMIN_PASSWORD)
			await page.getByLabel('Confirm password').fill(e2eEnv.E2E_ADMIN_PASSWORD)
			await page.getByRole('button', { name: 'Create the owner and finish setup' }).click()
			// waitForURL is bounded by the setup project's 180 s timeout, not expect's 30 s: a cold `next dev` compiles /login here.
			await page.waitForURL(/\/login\?email=/)
			setup
				.info()
				.annotations.push({ type: 'first-run', description: 'owner created through /init' })
		} else {
			await expect(page).toHaveURL(/\/login$/)
			setup.info().annotations.push({ type: 'first-run', description: 'database already set up' })
		}

		const db = await mysql.createConnection(e2eEnv.DATABASE_URL)
		for (const app of [...STUB_APPS, ...SEEDED_EXTRA_APPS]) {
			// A database that survives between runs keeps its rows: the display mode, the annotation switch, the
			// status and the icon are refreshed on them. The icon is the emoji the stub's /site answers (the DAL stores
			// it at create and sync; a seeded row needs it set), none for the app without a site. The stub apps are
			// open to everyone, as the B3a migration leaves existing apps (ADR-0027); specs that test access create
			// their own restricted apps (e2e/fixtures/access.ts).
			await db.execute(
				'INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, opening_statement_display_mode, enable_annotation, is_enabled, icon_type, icon, icon_background, access_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE opening_statement_display_mode = ?, enable_annotation = ?, is_enabled = ?, icon_type = ?, icon = ?, icon_background = ?, access_mode = ?',
				[
					app.id,
					app.name,
					app.mode,
					'Seeded for the e2e suite',
					`${stubApiBase}${app.prefix}`,
					'app-e2e',
					app.openingStatementDisplayMode,
					app.enableAnnotation,
					app.enabled === false ? 0 : 1,
					...(app.site === 'none' ? [null, null, null] : ['emoji', '🤖', '#FFEAD5']),
					'everyone',
					app.openingStatementDisplayMode,
					app.enableAnnotation,
					app.enabled === false ? 0 : 1,
					...(app.site === 'none' ? [null, null, null] : ['emoji', '🤖', '#FFEAD5']),
					'everyone',
				],
			)
		}
		await db.end()

		await signInAs(page, e2eEnv.E2E_ADMIN_EMAIL, e2eEnv.E2E_ADMIN_PASSWORD)
		await page.context().storageState({ path: ADMIN_STATE })
	},
)
