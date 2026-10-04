import { execSync } from 'node:child_process'

import { e2eEnv } from './fixtures/env'

/**
 * Starts the tmpfs MySQL (an already running container is reused, so its data persists until
 * `docker compose -f docker-compose.e2e.yml down`) and applies the migrations. Admin and app seeding
 * happen in e2e/auth.setup.ts (they need the app server).
 */
export default async function globalSetup() {
	execSync('docker compose -f docker-compose.e2e.yml up -d --wait', { stdio: 'inherit' })
	execSync('pnpm exec drizzle-kit migrate', {
		stdio: 'inherit',
		env: { ...process.env, DATABASE_URL: e2eEnv.DATABASE_URL },
	})
}
