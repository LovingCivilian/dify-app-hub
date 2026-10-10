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
})
