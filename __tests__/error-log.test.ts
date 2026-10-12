import { DrizzleQueryError } from 'drizzle-orm'
import { DatabaseError } from 'pg'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import { describeError, logSignInRefusal } from '@/lib/error-log'

describe('logSignInRefusal', () => {
	// B3 spec §7.3: the log carries a fixed reason code, so a subject key of the same name cannot replace it.
	it('logs the fixed reason code over a subject key of the same name', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
		try {
			logSignInRefusal('authorizeCredentials', 'account_inactive', {
				reason: 'free text',
				userId: 'u1',
			})
			expect(warn).toHaveBeenCalledTimes(1)
			expect(warn).toHaveBeenCalledWith('authorizeCredentials: sign-in refused', {
				reason: 'account_inactive',
				userId: 'u1',
			})
		} finally {
			warn.mockRestore()
		}
	})

	// Checked by tsc, which includes this file: the reason is one of the codes in use, not any string (B3b adds its own).
	it('takes only the fixed reason codes', () => {
		expectTypeOf(logSignInRefusal)
			.parameter(1)
			.toEqualTypeOf<
				| 'invalid_input'
				| 'account_inactive'
				| 'directory_account'
				| 'directory_off'
				| 'unknown_user'
				| 'ambiguous_user'
				| 'invalid_entry'
				| 'wrong_password'
				| 'entry_without_email'
				| 'email_in_use'
			>()
	})
})

describe('describeError and the directory (spec §7.3)', () => {
	it('keeps an ldapts result error to its name and LDAP result code', async () => {
		const { InvalidCredentialsError } = await import('ldapts')
		const described = describeError(
			new InvalidCredentialsError('80090308: LdapErr: DSID-0C09044E, data 52e'),
		)
		expect(described).toEqual({ name: 'InvalidCredentialsError', code: 49 })
	})

	it('keeps a directory error to its name and its cause reduced', async () => {
		const { DirectoryUnavailableError } = await import('@/lib/directory/errors')
		const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:389'), {
			code: 'ECONNREFUSED',
			errno: -111,
		})
		expect(describeError(new DirectoryUnavailableError({ cause }))).toEqual({
			name: 'DirectoryUnavailableError',
			cause: { name: 'Error', code: 'ECONNREFUSED', errno: -111 },
		})
	})

	// Decision u: a refusal the person's bind met while the socket died reaches the log with its result code (review M4).
	it('keeps the result code of a refusal wrapped as unreachable', async () => {
		const { UnavailableError } = await import('ldapts')
		const { DirectoryRefusedError, DirectoryUnavailableError } =
			await import('@/lib/directory/errors')
		const refused = new DirectoryRefusedError({
			cause: new UnavailableError(
				'00002024: SvcErr: DSID-031A1254, problem 5003 (WILL_NOT_PERFORM)',
			),
		})
		const described = describeError(new DirectoryUnavailableError({ cause: refused }))
		expect(described).toEqual({
			name: 'DirectoryUnavailableError',
			cause: {
				name: 'DirectoryRefusedError',
				cause: { name: 'UnavailableError', code: 52 },
			},
		})
		expect(JSON.stringify(described)).not.toContain('DSID')
	})

	// Node's TLS error carries the peer's whole certificate (`cert`) and the host; the log keeps its name, code and text.
	it('keeps a cause without an errno to its name, code and message', async () => {
		const { DirectoryUnavailableError } = await import('@/lib/directory/errors')
		const cause = Object.assign(new Error("Hostname/IP does not match certificate's altnames"), {
			code: 'ERR_TLS_CERT_ALTNAME_INVALID',
			host: 'dc.corp.example',
			cert: { subject: { CN: 'other.example' }, raw: Buffer.alloc(4) },
		})
		expect(describeError(new DirectoryUnavailableError({ cause }))).toEqual({
			name: 'DirectoryUnavailableError',
			cause: {
				name: 'Error',
				code: 'ERR_TLS_CERT_ALTNAME_INVALID',
				message: "Hostname/IP does not match certificate's altnames",
			},
		})
		expect(
			describeError(new DirectoryUnavailableError({ cause: new Error('Connection timeout') })),
		).toEqual({
			name: 'DirectoryUnavailableError',
			cause: { name: 'Error', message: 'Connection timeout' },
		})
	})

	// Final review I1: Node's file error carries the path in `path` and in its message (Node "Class: SystemError"); the
	// OWASP Logging Cheat Sheet lists file paths among the data to treat with care before logging. The log names the
	// setting and keeps the cause to its code.
	it('keeps an unreadable LDAP_CA_FILE to the setting and the cause’s code, never the path', async () => {
		const { readFile } = await import('node:fs/promises')
		const { DirectoryConfigError } = await import('@/lib/directory/errors')
		const path = '/nonexistent/ai-app-hub-corp-root-ca.pem'
		const cause = await readFile(path).catch((error: unknown) => error)
		expect(cause).toMatchObject({ code: 'ENOENT', path })
		const described = describeError(new DirectoryConfigError('LDAP_CA_FILE', { cause }))
		expect(described).toEqual({
			name: 'DirectoryConfigError',
			setting: 'LDAP_CA_FILE',
			cause: { code: 'ENOENT' },
		})
		expect(JSON.stringify(described)).not.toContain('corp-root-ca')
		// A cause without a string code keeps nothing of its message, which may hold the path.
		expect(
			describeError(new DirectoryConfigError('LDAP_CA_FILE', { cause: new Error(`open ${path}`) })),
		).toStrictEqual({ name: 'DirectoryConfigError', setting: 'LDAP_CA_FILE', cause: {} })
	})
})

describe('describeError and the database (decision g)', () => {
	/** A server error as node-postgres builds it, with the refused value in `detail`, as PostgreSQL sends it. */
	const serverError = () =>
		Object.assign(
			new DatabaseError(
				'duplicate key value violates unique constraint "users_email_key"',
				0,
				'error',
			),
			{
				code: '23505',
				constraint: 'users_email_key',
				detail: 'Key (lower(email))=(jane@example.com) already exists.',
			},
		)

	it('keeps a failed query to its name and SQLSTATE: no detail, no SQL, no parameter', () => {
		const hash = '$2a$12$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQ'
		const failed = new DrizzleQueryError(
			'insert into "users" ("id", "email", "password") values ($1, $2, $3)',
			['u1', 'jane@example.com', hash],
			serverError(),
		)
		const described = describeError(failed)
		expect(described).toEqual({ name: 'DrizzleQueryError', code: '23505' })
		for (const value of ['jane@example.com', hash, 'insert', 'Key ('])
			expect(JSON.stringify(described)).not.toContain(value)
	})

	// node-postgres "Pool", events: an idle client whose connection the server ended (a PostgreSQL restart, 57P01)
	// reaches the pool's error listener (db/index.ts) as a bare DatabaseError, whose name is the protocol's 'error'.
	it('keeps a bare server error to its name and SQLSTATE', () => {
		const ended = Object.assign(
			new DatabaseError('terminating connection due to administrator command', 0, 'error'),
			{ code: '57P01' },
		)
		expect(describeError(ended)).toEqual({ name: 'error', code: '57P01' })
		expect(describeError(serverError())).toStrictEqual({ name: 'error', code: '23505' })
	})

	it('keeps a refused connection to its code, and a lost one to its name', () => {
		const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
			code: 'ECONNREFUSED',
			errno: -111,
		})
		expect(describeError(new DrizzleQueryError('select 1', [], refused))).toStrictEqual({
			name: 'DrizzleQueryError',
			code: 'ECONNREFUSED',
		})
		// A Node system error on its own keeps its errno, as the directory's socket errors do.
		expect(describeError(refused)).toEqual({ name: 'Error', code: 'ECONNREFUSED', errno: -111 })
		// pg's own error for a connection that ended mid-query has no code (node_modules/pg/lib/client.js).
		const lost = new Error('Connection terminated unexpectedly')
		expect(describeError(new DrizzleQueryError('select 1', [], lost))).toStrictEqual({
			name: 'DrizzleQueryError',
			code: undefined,
		})
	})
})
