import {
	BusyError,
	ConfidentialityRequiredError,
	InvalidCredentialsError,
	NoSuchObjectError,
	StrongAuthRequiredError,
	UnavailableError,
} from 'ldapts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
	withDirectory: vi.fn(),
	findLoginEntries: vi.fn(),
	findGroupByKey: vi.fn(),
	isMemberOf: vi.fn(),
	bind: vi.fn(),
	order: [] as string[],
}))
vi.mock('@/lib/directory/connection', () => ({ withDirectory: mocks.withDirectory }))
vi.mock('@/lib/directory/operations', () => ({
	findLoginEntries: mocks.findLoginEntries,
	findGroupByKey: mocks.findGroupByKey,
	isMemberOf: mocks.isMemberOf,
}))

import { DirectoryRefusedError } from '@/lib/directory/errors'
import { checkDirectoryCredentials } from '@/lib/directory/sign-in'

const config = {
	idAttribute: 'objectGUID',
	loginAttribute: 'sAMAccountName',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
} as never
const alice = {
	dn: 'CN=Alice Admin,CN=Users,DC=corp',
	objectGUID: Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex'),
	sAMAccountName: 'alice',
	mail: 'alice@corp.example',
	displayName: 'Alice Admin',
}
const links = [
	{
		groupId: 'g1',
		directoryGroupId: 'k-eng',
		directoryGroupName: 'Engineering',
		missingSince: null,
	},
	{
		groupId: 'g2',
		directoryGroupId: 'k-eng',
		directoryGroupName: 'Engineering',
		missingSince: null,
	},
	{ groupId: 'g3', directoryGroupId: 'k-ops', directoryGroupName: 'Ops', missingSince: null },
]

beforeEach(() => {
	for (const fn of [
		mocks.withDirectory,
		mocks.findLoginEntries,
		mocks.findGroupByKey,
		mocks.isMemberOf,
		mocks.bind,
	])
		fn.mockReset()
	mocks.order.length = 0
	mocks.withDirectory.mockImplementation((_config: unknown, work: (client: unknown) => unknown) =>
		work({ bind: mocks.bind }),
	)
	mocks.findLoginEntries.mockResolvedValue([alice])
	mocks.findGroupByKey.mockImplementation(async (_c: unknown, _f: unknown, key: string) => {
		mocks.order.push(`group:${key}`)
		return key === 'k-eng' ? { dn: 'CN=Engineering,DC=corp', name: 'Engineering' } : null
	})
	mocks.isMemberOf.mockResolvedValue(true)
	mocks.bind.mockImplementation(async () => {
		mocks.order.push('bind')
	})
})

describe('checkDirectoryCredentials (spec §6.3)', () => {
	it('searches, resolves the linked groups as the service account, then binds as the entry', async () => {
		expect(await checkDirectoryCredentials(config, 'alice', 'pass word', links)).toEqual({
			ok: true,
			entry: {
				dn: alice.dn,
				key: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
				username: 'alice',
				email: 'alice@corp.example',
				name: 'Alice Admin',
			},
			groupIds: ['g1', 'g2'],
		})
		// Step 4 before step 5: each directory group looked up once, while still bound as the service account.
		expect(mocks.order).toEqual(['group:k-eng', 'group:k-ops', 'bind'])
		expect(mocks.bind).toHaveBeenCalledWith(alice.dn, 'pass word')
	})

	it('refuses an empty password or a blank username before any connection (RFC 4513 §5.1.2)', async () => {
		expect(await checkDirectoryCredentials(config, 'alice', '', links)).toEqual({
			ok: false,
			reason: 'wrong_password',
		})
		expect(await checkDirectoryCredentials(config, '  ', 'x', links)).toEqual({
			ok: false,
			reason: 'unknown_user',
		})
		expect(mocks.withDirectory).not.toHaveBeenCalled()
	})

	it.each([
		[[], 'unknown_user'],
		[[alice, alice], 'ambiguous_user'],
		[[{ ...alice, objectGUID: Buffer.alloc(3) }], 'invalid_entry'],
	] as const)('refuses %j entries as %s, and never binds', async (entries, reason) => {
		mocks.findLoginEntries.mockResolvedValue(entries)
		expect(await checkDirectoryCredentials(config, 'alice', 'x', links)).toEqual({
			ok: false,
			reason,
		})
		expect(mocks.bind).not.toHaveBeenCalled()
	})

	it('reads invalidCredentials on the user bind as a wrong password', async () => {
		mocks.bind.mockRejectedValue(new InvalidCredentialsError('bad'))
		expect(await checkDirectoryCredentials(config, 'alice', 'x', links)).toEqual({
			ok: false,
			reason: 'wrong_password',
		})
	})

	it('reads strongerAuthRequired and confidentialityRequired as the directory refusing (decision u)', async () => {
		for (const error of [
			new StrongAuthRequiredError('signing'),
			new ConfidentialityRequiredError('tls'),
		]) {
			mocks.bind.mockRejectedValue(error)
			await expect(checkDirectoryCredentials(config, 'alice', 'x', links)).rejects.toBeInstanceOf(
				DirectoryRefusedError,
			)
		}
	})

	// RFC 4511 Appendix A: busy (51) "the server is too busy to service the operation", unavailable (52) "the server is
	// shutting down or a subsystem necessary to complete the operation is offline"; the password is not at fault, so the
	// person is told the directory is unreachable (decision u).
	it('reads busy and unavailable on the user bind as the directory refusing (decision u)', async () => {
		for (const error of [new BusyError('busy'), new UnavailableError('unavailable')]) {
			mocks.bind.mockRejectedValue(error)
			await expect(checkDirectoryCredentials(config, 'alice', 'x', links)).rejects.toBeInstanceOf(
				DirectoryRefusedError,
			)
		}
	})

	// Decision u: busy (51) and unavailable (52) describe the server, not the operation (RFC 4511 Appendix A), so the
	// service account's searches answer them as the bind does: the directory is unreachable, whoever is signing in.
	it('reads busy on the login search and unavailable on a group lookup as the directory refusing (decision u)', async () => {
		const busy = new BusyError('busy')
		mocks.findLoginEntries.mockRejectedValueOnce(busy)
		const fromSearch = await checkDirectoryCredentials(config, 'alice', 'x', links).catch(
			(error: unknown) => error,
		)
		expect(fromSearch).toBeInstanceOf(DirectoryRefusedError)
		expect((fromSearch as Error).cause).toBe(busy)

		const unavailable = new UnavailableError('shutting down')
		mocks.findGroupByKey.mockRejectedValueOnce(unavailable)
		const fromLookup = await checkDirectoryCredentials(config, 'alice', 'x', links).catch(
			(error: unknown) => error,
		)
		expect(fromLookup).toBeInstanceOf(DirectoryRefusedError)
		expect((fromLookup as Error).cause).toBe(unavailable)
		expect(mocks.bind).not.toHaveBeenCalled()
	})

	it('passes any other directory answer through', async () => {
		const other = new NoSuchObjectError('gone')
		mocks.bind.mockRejectedValue(other)
		await expect(checkDirectoryCredentials(config, 'alice', 'x', links)).rejects.toBe(other)
		// Only 51 and 52 are read by the server's state: any other code from a search stays as it is (`Default`).
		mocks.findLoginEntries.mockRejectedValueOnce(other)
		await expect(checkDirectoryCredentials(config, 'alice', 'x', links)).rejects.toBe(other)
	})
})
