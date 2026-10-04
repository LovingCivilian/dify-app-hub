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
		},
	},
})
