import { execSync } from 'node:child_process'

const compose = 'docker compose -f docker-compose.e2e.yml'
const down = () => execSync(`${compose} down ldap-ad ldap-openldap`, { stdio: 'inherit' })

/**
 * Starts the two LDAP test directories for `pnpm test:ldap` (Vitest "globalSetup": it runs only when tests are queued,
 * and a returned function is the teardown), and stops them afterwards, so nothing is left running (decision i). A
 * setup that throws returns no teardown (Vitest keeps the returned function only once setup resolves), so a server
 * that never turns healthy is stopped here before the error is rethrown.
 */
export default function setup() {
	try {
		execSync(`${compose} up -d --wait --wait-timeout 300 ldap-ad ldap-openldap`, {
			stdio: 'inherit',
		})
	} catch (error) {
		try {
			down()
		} catch (downError) {
			// Both fail when Docker itself is unreachable; a failed stop must not hide why the start failed, so both
			// errors travel together (MDN "AggregateError": "when several errors need to be wrapped in a single error").
			throw new AggregateError(
				[error, downError],
				'The LDAP test directories did not start, and stopping them failed',
			)
		}
		throw error
	}
	return down
}
