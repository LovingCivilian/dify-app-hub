import { test as setup } from '@playwright/test'

import { ADMIN_STATE } from './fixtures/constants'

setup(
	'placeholder storage state until Task 4 seeds the database and signs in',
	async ({ page }) => {
		await page.goto('/login')
		await page.context().storageState({ path: ADMIN_STATE })
	},
)
