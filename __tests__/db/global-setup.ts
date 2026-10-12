import { execSync } from 'node:child_process'

import { Client } from 'pg'

import { HUB_DAL_URL } from './database'

const compose = 'docker compose -f docker-compose.e2e.yml'
/** The e2e server's own database, reached as its superuser (docker-library postgres: POSTGRES_USER is created "with superuser power"). */
const ADMIN_URL = 'postgres://e2e:e2e@127.0.0.1:5433/e2e'
const down = () => execSync(`${compose} down postgres`, { stdio: 'inherit' })

/**
 * Starts the e2e PostgreSQL for `pnpm test:db` and gives the suite a database of its own, so the e2e suite's `e2e`
 * database is never touched (Vitest "globalSetup": it runs only when tests are queued, and a returned function is the
 * teardown). `hub_dal` is dropped and created empty, then migrated by drizzle-kit, as e2e/global-setup.ts migrates the
 * e2e database. As __tests__/ldap/global-setup.ts does, a setup that fails stops the server before the error is
 * rethrown, and the teardown stops it, so nothing is left running (decision i).
 */
export default async function setup() {
	try {
		execSync(`${compose} up -d --wait --wait-timeout 120 postgres`, { stdio: 'inherit' })
		const admin = new Client({ connectionString: ADMIN_URL })
		await admin.connect()
		try {
			// PostgreSQL 18 "DROP DATABASE": FORCE ends the connections a crashed run left open.
			await admin.query('DROP DATABASE IF EXISTS hub_dal WITH (FORCE)')
			await admin.query('CREATE DATABASE hub_dal')
		} finally {
			await admin.end()
		}
		execSync('pnpm exec drizzle-kit migrate', {
			stdio: 'inherit',
			env: { ...process.env, DATABASE_URL: HUB_DAL_URL },
		})
	} catch (error) {
		try {
			down()
		} catch (downError) {
			// MDN "AggregateError": "when several errors need to be wrapped in a single error".
			throw new AggregateError(
				[error, downError],
				'The test PostgreSQL did not start, and stopping it failed',
			)
		}
		throw error
	}
	return down
}
