import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		// Playwright specs under e2e/ run with `pnpm test:e2e`, not vitest; tmp/ is git-ignored scratch (research
		// clones carry their own test files), so it is never collected (owner, 2026-10-10).
		exclude: [...configDefaults.exclude, 'e2e/**', 'tmp/**'],
		// Decision j (Vitest "Test Projects"): `unit` is `pnpm test`; `ldap` needs the two test directories of
		// docker-compose.e2e.yml and runs only through `pnpm test:ldap`.
		projects: [
			{
				extends: true,
				test: {
					name: 'unit',
					exclude: [...configDefaults.exclude, 'e2e/**', 'tmp/**', '**/*.ldap.test.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'ldap',
					include: ['__tests__/ldap/**/*.ldap.test.ts'],
					globalSetup: ['./__tests__/ldap/global-setup.ts'],
					hookTimeout: 120_000,
					testTimeout: 30_000,
				},
			},
		],
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname),
			// Disable server-only: Next's Jest guide maps it to a project-local empty module (testing/jest.md,
			// moduleNameMapper); vitest does the same through this alias.
			'server-only': path.resolve(__dirname, '__mocks__/empty.js'),
		},
	},
})
