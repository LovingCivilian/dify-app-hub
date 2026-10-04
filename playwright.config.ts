import { defineConfig, devices } from '@playwright/test'

import { ADMIN_STATE } from './e2e/fixtures/constants'
import { baseURL, e2eEnv, stubPort } from './e2e/fixtures/env'

const signedIn = { storageState: ADMIN_STATE }

export default defineConfig({
	testDir: './e2e',
	globalSetup: './e2e/global-setup.ts',
	// `next dev` compiles each route on first visit, so the first project to reach a page waits for it
	// (a click that navigates to an uncompiled route took 10 s and more): test and assertion timeouts
	// are raised above their defaults.
	timeout: 120_000,
	expect: { timeout: 30_000 },
	fullyParallel: false,
	workers: 1,
	reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
	use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	webServer: [
		{
			command: 'pnpm exec tsx e2e/fixtures/dify-stub.ts',
			url: `http://127.0.0.1:${stubPort}/v1/parameters`,
			reuseExistingServer: true,
			env: e2eEnv,
		},
		{
			command: 'pnpm exec next dev -p 5301',
			// Playwright starts web servers before globalSetup, so MySQL is not up yet on a cold run:
			// readiness must not depend on the database (/api/health answers 500 without it).
			url: `${baseURL}/api/auth/providers`,
			reuseExistingServer: true,
			timeout: 120_000,
			env: e2eEnv,
		},
	],
	projects: [
		{
			name: 'setup',
			testMatch: /.*\.setup\.ts/,
			// First visit to a cold `next dev`: Turbopack compiles each route on demand (/init took 68 s here).
			timeout: 180_000,
		},
		{
			name: 'desktop-light',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
				colorScheme: 'light',
				...signedIn,
			},
			dependencies: ['setup'],
		},
		{
			name: 'desktop-dark',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 800 },
				colorScheme: 'dark',
				...signedIn,
			},
			dependencies: ['setup'],
		},
		{
			name: 'mobile-light',
			use: { ...devices['Pixel 7'], colorScheme: 'light', ...signedIn },
			dependencies: ['setup'],
		},
	],
})
