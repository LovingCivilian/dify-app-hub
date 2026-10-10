import { execFileSync } from 'node:child_process'

import type { RowDataPacket } from 'mysql2/promise'

import { withDb } from './db'

/** The seeded people's password in the smblds test directory (e2e/fixtures/ldap/ad/entrypoint.d/20-seed.sh). */
export const DIRECTORY_PASSWORD = 'E2e-Dir-Passw0rd'

/**
 * Decision aa: a Samba provisioned again issues new objectGUIDs, so the directory accounts and links a previous run left
 * in the reused e2e MySQL would collide with the next first sign-in. Deleting the accounts removes their memberships
 * (ON DELETE CASCADE, ADR-0027).
 */
export const resetDirectoryState = () =>
	withDb(async db => {
		await db.execute('DELETE FROM user_group_directory_links')
		await db.execute("DELETE FROM users WHERE source = 'ldap'")
		await db.execute('DELETE FROM directory_sync_runs')
	})

export const deleteDirectoryAccount = (email: string) =>
	withDb(db => db.execute("DELETE FROM users WHERE source = 'ldap' AND email = ?", [email]))

/** The account with this email, of either source, as the database holds it, or undefined. */
export const directoryAccount = (email: string) =>
	withDb(async db => {
		const [rows] = await db.execute<RowDataPacket[]>(
			'SELECT id, source, role, password, directory_id, directory_id_attribute, directory_username, directory_deactivated_at FROM users WHERE email = ?',
			[email],
		)
		return rows[0]
	})

/** The `ldap` accounts with this directory username (an entry without an email has no email to look up by). */
export const directoryAccountsByUsername = (username: string) =>
	withDb(async db => {
		const [rows] = await db.execute<RowDataPacket[]>(
			"SELECT id FROM users WHERE source = 'ldap' AND directory_username = ?",
			[username],
		)
		return rows
	})

/** Runs samba-tool in the test directory (`docker compose exec`, documented); a spec restores what it changes in `afterEach`. */
export const samba = (args: string[]) =>
	execFileSync(
		'docker',
		['compose', '-f', 'docker-compose.e2e.yml', 'exec', '-T', 'ldap-ad', 'samba-tool', ...args],
		{
			stdio: 'pipe',
		},
	)
