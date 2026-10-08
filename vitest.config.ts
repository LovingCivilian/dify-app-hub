import path from 'path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		// Playwright specs under e2e/ run with `pnpm test:e2e`, not vitest.
		exclude: [...configDefaults.exclude, 'e2e/**'],
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
