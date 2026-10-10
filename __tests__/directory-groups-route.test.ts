import { InvalidCredentialsError, NoSuchObjectError } from 'ldapts'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getServerSession, searchDirectoryGroups } = vi.hoisted(() => ({
	getServerSession: vi.fn(),
	searchDirectoryGroups: vi.fn(),
}))
// The real session chain (ADR-0024 deviation 3): verifySession and the role check run as in production.
vi.mock('next-auth/next', () => ({ getServerSession }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/options', () => ({ authOptions: {} }))
vi.mock('@/lib/directory/admin', () => ({ searchDirectoryGroups }))

import { GET } from '@/app/api/directory/groups/route'
import {
	DirectoryConfigError,
	DirectoryRefusedError,
	DirectoryUnavailableError,
} from '@/lib/directory/errors'

const owner = { id: 'o1', email: 'owner@example.com', name: 'Owner', role: 'owner' }
const admin = { id: 'a1', email: 'admin@example.com', name: 'Admin', role: 'admin' }
const user = { id: 'u1', email: 'user@example.com', name: 'User', role: 'user' }
const get = (query: string) => GET(new NextRequest(`http://app/api/directory/groups${query}`))

beforeEach(() => {
	getServerSession.mockReset()
	searchDirectoryGroups.mockReset()
})

describe('GET /api/directory/groups (spec §6.5, decision al)', () => {
	it('refuses a missing session with 401 and a user-role session with 403, before the directory', async () => {
		getServerSession.mockResolvedValue(null)
		const signedOut = await get('?q=eng')
		expect(signedOut.status).toBe(401)
		await expect(signedOut.json()).resolves.toEqual({
			code: 'unauthorized',
			message: 'Sign in required.',
			status: 401,
		})
		getServerSession.mockResolvedValue({ user })
		const refused = await get('?q=eng')
		expect(refused.status).toBe(403)
		await expect(refused.json()).resolves.toMatchObject({ code: 'forbidden' })
		expect(searchDirectoryGroups).not.toHaveBeenCalled()
	})

	// Review Focus 1 and decision al: a text under two characters, over 64, or missing never reaches the directory.
	it.each([['?q=e'], ['?q=%20e%20'], [`?q=${'x'.repeat(65)}`], ['']])(
		'answers 400 invalid_param for %s and searches nothing',
		async query => {
			getServerSession.mockResolvedValue({ user: admin })
			const response = await get(query)
			expect(response.status).toBe(400)
			await expect(response.json()).resolves.toMatchObject({ code: 'invalid_param', status: 400 })
			expect(searchDirectoryGroups).not.toHaveBeenCalled()
		},
	)

	it('answers 409 directory_off while the LDAP_* block is unset', async () => {
		getServerSession.mockResolvedValue({ user: owner })
		searchDirectoryGroups.mockResolvedValue(null)
		const response = await get('?q=eng')
		expect(response.status).toBe(409)
		await expect(response.json()).resolves.toMatchObject({ code: 'directory_off' })
	})

	// Global Constraints: a DTO carries only what the screen needs; the answer is one admin's, never cached.
	it('answers the trimmed text’s groups as { key, name } only, with no-store', async () => {
		getServerSession.mockResolvedValue({ user: admin })
		searchDirectoryGroups.mockResolvedValue([
			{ key: 'k1', name: 'Engineering', dn: 'CN=Engineering,OU=Groups,DC=corp,DC=example' },
		])
		const response = await get('?q=%20eng%20')
		expect(response.status).toBe(200)
		expect(response.headers.get('cache-control')).toBe('private, no-store')
		await expect(response.json()).resolves.toEqual([{ key: 'k1', name: 'Engineering' }])
		expect(searchDirectoryGroups).toHaveBeenCalledWith(
			{ id: 'a1', email: 'admin@example.com', name: 'Admin', role: 'admin' },
			'eng',
		)
	})

	// Decision u, spec §7.3: an unreachable or refusing directory is 503 directory_unavailable, and the log carries the
	// class and the LDAP result code, never the directory's diagnostic text.
	it('answers 503 directory_unavailable for an unreachable or refusing directory, logged reduced', async () => {
		getServerSession.mockResolvedValue({ user: admin })
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			searchDirectoryGroups.mockRejectedValueOnce(
				new DirectoryUnavailableError({ cause: new Error('Connection timeout') }),
			)
			const unreachable = await get('?q=eng')
			expect(unreachable.status).toBe(503)
			await expect(unreachable.json()).resolves.toMatchObject({ code: 'directory_unavailable' })
			searchDirectoryGroups.mockRejectedValueOnce(
				new DirectoryRefusedError({
					cause: new InvalidCredentialsError('80090308: LdapErr: DSID-0C09044E, data 52e'),
				}),
			)
			const refused = await get('?q=eng')
			expect(refused.status).toBe(503)
			await expect(refused.json()).resolves.toMatchObject({ code: 'directory_unavailable' })
			expect(log).toHaveBeenLastCalledWith('GET /api/directory/groups:', {
				name: 'DirectoryRefusedError',
				cause: { name: 'InvalidCredentialsError', code: 49 },
			})
		} finally {
			log.mockRestore()
		}
	})

	it('answers any other failure as a 500 without detail, logged by name and code', async () => {
		getServerSession.mockResolvedValue({ user: admin })
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			searchDirectoryGroups.mockRejectedValueOnce(
				new NoSuchObjectError('0000208D: NameErr: DSID-03100241, problem 2001 (NO_OBJECT)'),
			)
			const response = await get('?q=eng')
			expect(response.status).toBe(500)
			await expect(response.json()).resolves.toEqual({
				code: 'internal_error',
				message: 'Internal Server Error',
				status: 500,
			})
			expect(log).toHaveBeenCalledWith('GET /api/directory/groups:', {
				name: 'NoSuchObjectError',
				code: 32,
			})
		} finally {
			log.mockRestore()
		}
	})

	// Final review I1: the route keeps its 500 envelope for a CA file it cannot read; the log names the setting.
	it('answers an unreadable LDAP_CA_FILE as a 500, logged by the setting and the code only', async () => {
		getServerSession.mockResolvedValue({ user: admin })
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			const cause = Object.assign(
				new Error("ENOENT: no such file or directory, open '/run/ca.pem'"),
				{
					code: 'ENOENT',
					errno: -2,
					path: '/run/ca.pem',
				},
			)
			searchDirectoryGroups.mockRejectedValueOnce(
				new DirectoryConfigError('LDAP_CA_FILE', { cause }),
			)
			const response = await get('?q=eng')
			expect(response.status).toBe(500)
			await expect(response.json()).resolves.toEqual({
				code: 'internal_error',
				message: 'Internal Server Error',
				status: 500,
			})
			expect(log).toHaveBeenCalledWith('GET /api/directory/groups:', {
				name: 'DirectoryConfigError',
				setting: 'LDAP_CA_FILE',
				cause: { code: 'ENOENT' },
			})
			expect(JSON.stringify(log.mock.calls)).not.toContain('/run/ca.pem')
		} finally {
			log.mockRestore()
		}
	})
})
