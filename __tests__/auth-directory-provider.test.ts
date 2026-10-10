import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	directoryConfig: vi.fn(),
	checkDirectoryCredentials: vi.fn(),
	listGroupLinks: vi.fn(),
	recordDirectorySignIn: vi.fn(),
	pad: vi.fn(),
	record: vi.fn(),
}))
vi.mock('@/lib/directory/config', () => ({ directoryConfig: mocks.directoryConfig }))
vi.mock('@/lib/directory/sign-in', () => ({
	checkDirectoryCredentials: mocks.checkDirectoryCredentials,
}))
vi.mock('@/lib/data/directory', () => ({
	listGroupLinks: mocks.listGroupLinks,
	recordDirectorySignIn: mocks.recordDirectorySignIn,
}))
vi.mock('@/lib/directory/response-floor', () => ({
	directoryResponseFloor: { pad: mocks.pad, record: mocks.record },
}))

import { authorizeDirectory } from '@/lib/auth/directory-provider'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'

const config = { idAttribute: 'objectGUID' }
const entry = {
	dn: 'CN=Alice',
	key: 'k-alice',
	username: 'alice',
	email: 'alice@corp.example',
	name: 'Alice',
}
const account = {
	id: 'u1',
	email: 'alice@corp.example',
	name: 'Alice',
	role: 'user',
	sessionVersion: 0,
}

let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>
beforeEach(() => {
	for (const fn of Object.values(mocks)) fn.mockReset()
	mocks.directoryConfig.mockReturnValue(config)
	mocks.listGroupLinks.mockResolvedValue([])
	mocks.checkDirectoryCredentials.mockResolvedValue({ ok: true, entry, groupIds: ['g1'] })
	mocks.recordDirectorySignIn.mockResolvedValue({ ok: true, account, emailConflict: false })
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
	error = vi.spyOn(console, 'error').mockImplementation(() => {})
	return () => {
		warn.mockRestore()
		error.mockRestore()
	}
})

describe('authorizeDirectory (spec §6.3, §7.3)', () => {
	it('signs a directory account in, keyed by its entry, and records the duration for the floor', async () => {
		expect(
			await authorizeDirectory({
				username: ' alice ',
				password: 'pass word',
				csrfToken: 'x',
				json: 'true',
			}),
		).toEqual({
			...account,
			source: 'ldap',
		})
		expect(mocks.checkDirectoryCredentials).toHaveBeenCalledWith(config, 'alice', 'pass word', [])
		expect(mocks.recordDirectorySignIn).toHaveBeenCalledWith(
			{
				key: 'k-alice',
				idAttribute: 'objectGUID',
				username: 'alice',
				email: 'alice@corp.example',
				name: 'Alice',
			},
			['g1'],
		)
		expect(mocks.record).toHaveBeenCalledTimes(1)
		expect(mocks.pad).not.toHaveBeenCalled()
	})

	// Review Focus 1: a password of spaces is a password (decision w), passed on as typed, never trimmed to empty.
	it('passes a password of spaces on as typed', async () => {
		await authorizeDirectory({ username: 'alice', password: '   ' })
		expect(mocks.checkDirectoryCredentials).toHaveBeenCalledWith(config, 'alice', '   ', [])
	})

	it('refuses bad input before the directory (decision w)', async () => {
		for (const input of [
			undefined,
			{},
			{ username: 'alice', password: '' },
			{ username: ' ', password: 'x' },
			{ username: 'a'.repeat(256), password: 'x' },
		])
			expect(await authorizeDirectory(input)).toBeNull()
		expect(mocks.checkDirectoryCredentials).not.toHaveBeenCalled()
	})

	it.each([
		[
			'the directory refuses the credentials',
			() =>
				mocks.checkDirectoryCredentials.mockResolvedValue({ ok: false, reason: 'unknown_user' }),
			'unknown_user',
		],
		[
			'an admin deactivated the account',
			() =>
				mocks.recordDirectorySignIn.mockResolvedValue({ ok: false, reason: 'account_inactive' }),
			'account_inactive',
		],
		[
			'the entry has no email',
			() =>
				mocks.recordDirectorySignIn.mockResolvedValue({ ok: false, reason: 'entry_without_email' }),
			'entry_without_email',
		],
		[
			'another account uses the email',
			() => mocks.recordDirectorySignIn.mockResolvedValue({ ok: false, reason: 'email_in_use' }),
			'email_in_use',
		],
		['LDAP is off', () => mocks.directoryConfig.mockReturnValue(null), 'directory_off'],
	])(
		'answers null when %s, logs the reason with the username, and pads the time (decision t)',
		async (_name, arrange, reason) => {
			arrange()
			expect(await authorizeDirectory({ username: 'alice', password: 'secret-pass' })).toBeNull()
			expect(warn).toHaveBeenCalledWith('authorizeDirectory: sign-in refused', {
				username: 'alice',
				reason,
			})
			expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-pass')
			expect(mocks.pad).toHaveBeenCalledTimes(1)
		},
	)

	it('logs an email kept because another account has it', async () => {
		mocks.recordDirectorySignIn.mockResolvedValue({ ok: true, account, emailConflict: true })
		await authorizeDirectory({ username: 'alice', password: 'x' })
		expect(warn).toHaveBeenCalledWith('authorizeDirectory: directory email kept', {
			userId: 'u1',
			reason: 'email_conflict',
		})
	})

	it.each([
		['unreachable', new DirectoryUnavailableError({ cause: new Error('ECONNREFUSED') })],
		[
			'refusing the connection (decision u)',
			new DirectoryRefusedError({ cause: new Error('code 8') }),
		],
	])('throws DirectoryUnavailable when the directory is %s, unpadded', async (_name, failure) => {
		mocks.checkDirectoryCredentials.mockRejectedValue(failure)
		await expect(authorizeDirectory({ username: 'alice', password: 'x' })).rejects.toThrow(
			'DirectoryUnavailable',
		)
		expect(error).toHaveBeenCalled()
		expect(mocks.pad).not.toHaveBeenCalled()
	})

	it('throws Default for anything else, such as a database failure', async () => {
		mocks.recordDirectorySignIn.mockRejectedValue(
			Object.assign(new Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' }),
		)
		await expect(authorizeDirectory({ username: 'alice', password: 'x' })).rejects.toThrow(
			'Default',
		)
	})
})
