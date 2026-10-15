import { expect, test as setup } from '@playwright/test'

import {
	ADMIN_STATE,
	aguiAgentUrl,
	SEEDED_EXTRA_APPS,
	STUB_AGUI_APPS,
	STUB_AGUI_AUDIENCE,
	STUB_APPS,
} from './fixtures/constants'
import { withDb } from './fixtures/db'
import { e2eEnv, stubApiBase, stubPort } from './fixtures/env'
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

		await withDb(async db => {
			for (const app of [...STUB_APPS, ...SEEDED_EXTRA_APPS]) {
				// A database that survives between runs keeps its rows: the status and the documents are refreshed on them,
				// and the icon is cleared (decision 19: no emoji; a stub app shows Dify's fallback icon). The stub apps are
				// open to everyone, as the B3a migration left existing apps (ADR-0027); specs that test access create their
				// own restricted apps (e2e/fixtures/access.ts). PostgreSQL 18 "INSERT", ON CONFLICT DO UPDATE: the SET list
				// reads the proposed row through the special table EXCLUDED. The documents go as JSON text cast to jsonb.
				await db.query(
					"INSERT INTO apps (id, provider, name, description, is_enabled, access_mode, settings, secrets) VALUES ($1, 'dify', $2, 'Seeded for the e2e suite', $3, 'everyone', $4::jsonb, $5::jsonb) ON CONFLICT (id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, access_mode = EXCLUDED.access_mode, settings = EXCLUDED.settings, secrets = EXCLUDED.secrets, icon_image = NULL, icon_mime = NULL",
					[
						app.id,
						app.name,
						app.enabled !== false,
						JSON.stringify({
							apiBase: `${stubApiBase}${app.prefix}`,
							appType: app.mode,
							answerForm: { enabled: false, feedbackText: '' },
							enableUpdateAfterConversationStarts: false,
							openingStatementDisplayMode: app.openingStatementDisplayMode,
						}),
						JSON.stringify({ apiKey: 'app-e2e' }),
					],
				)
			}
			// Part 2 spec §10: two AG-UI apps on the stub agent (plan call P14), open to everyone like the stub apps. The
			// documents are the AG-UI provider's (spec §2.2): the agent's URL, the JWT audience, the `askUser` switch (2b's
			// plan call P18: on for the agent that answers) and the shared secret.
			for (const app of STUB_AGUI_APPS) {
				await db.query(
					"INSERT INTO apps (id, provider, name, description, is_enabled, access_mode, settings, secrets) VALUES ($1, 'agui', $2, 'Seeded for the e2e suite', true, 'everyone', $3::jsonb, $4::jsonb) ON CONFLICT (id) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, access_mode = EXCLUDED.access_mode, settings = EXCLUDED.settings, secrets = EXCLUDED.secrets, icon_image = NULL, icon_mime = NULL",
					[
						app.id,
						app.name,
						JSON.stringify({
							agentUrl: aguiAgentUrl(stubPort, app.agent),
							audience: STUB_AGUI_AUDIENCE,
							askUser: app.askUser,
						}),
						JSON.stringify({ jwtSecret: e2eEnv.E2E_AGUI_JWT_SECRET }),
					],
				)
			}
			// The e2e database outlives a run (e2e/global-setup.ts reuses the container): the AG-UI apps' conversations of an
			// earlier run are removed, so each run's sidebar starts empty. Runs and messages go with them (ON DELETE CASCADE,
			// spec §3.1).
			await db.query('DELETE FROM conversations WHERE app_id = ANY($1::uuid[])', [
				STUB_AGUI_APPS.map(app => app.id),
			])
		})

		await signInAs(page, e2eEnv.E2E_ADMIN_EMAIL, e2eEnv.E2E_ADMIN_PASSWORD)
		await page.context().storageState({ path: ADMIN_STATE })
	},
)
