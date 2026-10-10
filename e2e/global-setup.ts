import { execSync } from 'node:child_process'

import { resetDirectoryState } from './fixtures/directory'
import { e2eEnv } from './fixtures/env'

/**
 * Starts the tmpfs MySQL and the smblds test directory (running containers are reused: MySQL's data and the
 * directory's provisioning persist until `docker compose -f docker-compose.e2e.yml --profile ldap down -v`; a plain
 * `down` leaves ldap-ad, Docker "Using profiles with Compose"), applies the migrations, and clears the directory
 * accounts a previous run left (decision aa). ldap-ad is started by name: its profile keeps it out of a plain `up`
 * (Docker docs, "Using profiles with Compose"). Admin and app seeding happen in e2e/auth.setup.ts (they need the app).
 */
export default async function globalSetup() {
	execSync(
		'docker compose -f docker-compose.e2e.yml up -d --wait --wait-timeout 300 mysql ldap-ad',
		{
			stdio: 'inherit',
		},
	)
	execSync('pnpm exec drizzle-kit migrate', {
		stdio: 'inherit',
		env: { ...process.env, DATABASE_URL: e2eEnv.DATABASE_URL },
	})
	await resetDirectoryState()
}
