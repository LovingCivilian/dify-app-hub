import { InvalidCredentialsError, NoSuchObjectError, UnavailableError } from 'ldapts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A fake ldapts Client that records its options and calls; the error classes stay ldapts' own. */
const mocks = vi.hoisted(() => {
	const state = {
		options: undefined as Record<string, unknown> | undefined,
		calls: [] as unknown[][],
		connected: true,
		failAt: undefined as undefined | { step: 'startTLS' | 'bind'; error: unknown },
	}
	class Client {
		constructor(options: Record<string, unknown>) {
			state.options = options
		}
		get isConnected() {
			return state.connected
		}
		async startTLS(options: unknown) {
			state.calls.push(['startTLS', options])
			if (state.failAt?.step === 'startTLS') throw state.failAt.error
		}
		async bind(dn: string, password: string) {
			state.calls.push(['bind', dn, password])
			if (state.failAt?.step === 'bind') throw state.failAt.error
		}
		async unbind() {
			state.calls.push(['unbind'])
		}
	}
	return { state, Client }
})
vi.mock('ldapts', async importOriginal => ({
	...(await importOriginal<typeof import('ldapts')>()),
	Client: mocks.Client,
}))
const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile }))
// Node's socket factories, faked so a test can call the ones the client was given (decision p).
const sockets = vi.hoisted(() => ({
	tcp: vi.fn(() => 'tcp socket'),
	tls: vi.fn(() => 'tls socket'),
}))
vi.mock('node:net', async importOriginal => {
	const net = await importOriginal<typeof import('node:net')>()
	return { ...net, default: { ...net, connect: sockets.tcp } }
})
vi.mock('node:tls', async importOriginal => {
	const tls = await importOriginal<typeof import('node:tls')>()
	return { ...tls, default: { ...tls, connect: sockets.tls } }
})

import {
	CONNECT_TIMEOUT_MS,
	oncePerClient,
	OPERATION_TIMEOUT_MS,
	withDirectory,
} from '@/lib/directory/connection'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'

const base = {
	bindDn: 'CN=svc,DC=corp',
	bindPassword: 'secret',
	caFile: '/run/ca.pem',
} as const
const config = (
	url: string,
	encryption: 'ldaps' | 'starttls' | 'none',
	overrides: Record<string, unknown> = {},
) => ({ ...base, url, encryption, ...overrides }) as never

beforeEach(() => {
	Object.assign(mocks.state, { options: undefined, calls: [], connected: true, failAt: undefined })
	readFile.mockReset()
	readFile.mockResolvedValue(Buffer.from('PEM'))
})

describe('withDirectory: the three modes (spec §6.2, decisions p and r)', () => {
	it('ldaps: direct TLS with the CA and the host name, both timeouts, a single-use secure factory', async () => {
		await withDirectory(config('ldaps://dc.corp.example:636', 'ldaps'), async () => 'done')
		expect(mocks.state.options).toMatchObject({
			url: 'ldaps://dc.corp.example:636',
			connectTimeout: CONNECT_TIMEOUT_MS,
			timeout: OPERATION_TIMEOUT_MS,
			tlsOptions: {
				host: 'dc.corp.example',
				servername: 'dc.corp.example',
				minVersion: 'TLSv1.2',
				rejectUnauthorized: true,
				ca: [Buffer.from('PEM')],
			},
		})
		expect(mocks.state.options?.createSecureConnection).toBeTypeOf('function')
		expect(mocks.state.calls).toEqual([['bind', 'CN=svc,DC=corp', 'secret'], ['unbind']])
	})

	it('starttls: no TLS option on the constructor; startTLS with them before any bind', async () => {
		await withDirectory(config('ldap://dc.corp.example:389', 'starttls'), async () => undefined)
		expect(mocks.state.options).not.toHaveProperty('tlsOptions')
		expect(mocks.state.options?.createConnection).toBeTypeOf('function')
		expect(mocks.state.calls[0]).toEqual([
			'startTLS',
			{
				host: 'dc.corp.example',
				servername: 'dc.corp.example',
				minVersion: 'TLSv1.2',
				rejectUnauthorized: true,
				ca: [Buffer.from('PEM')],
			},
		])
		expect(mocks.state.calls[1][0]).toBe('bind')
	})

	it('none: plain, no TLS at all, no CA read', async () => {
		await withDirectory(config('ldap://10.0.0.5:389', 'none'), async () => undefined)
		expect(mocks.state.options).not.toHaveProperty('tlsOptions')
		expect(mocks.state.calls.map(call => call[0])).toEqual(['bind', 'unbind'])
		expect(readFile).not.toHaveBeenCalled()
	})

	it('leaves the server name out for an IP address and the CA out without a file', async () => {
		await withDirectory(
			config('ldaps://10.0.0.5:636', 'ldaps', { caFile: null }),
			async () => undefined,
		)
		expect(mocks.state.options?.tlsOptions).toEqual({
			host: '10.0.0.5',
			minVersion: 'TLSv1.2',
			rejectUnauthorized: true,
		})
	})

	// ldapts reconnects a client used after the server closed it or after unbind() (README "Custom connection
	// factories"), and after StartTLS that reconnect is plain TCP; the factories it is given open one connection.
	it('gives ldapts factories that open one connection each, in every mode (decision p)', async () => {
		for (const [url, encryption, factory, socket] of [
			['ldaps://dc.corp.example:636', 'ldaps', 'createSecureConnection', 'tls socket'],
			['ldap://dc.corp.example:389', 'starttls', 'createConnection', 'tcp socket'],
			['ldap://dc.corp.example:389', 'none', 'createConnection', 'tcp socket'],
		] as const) {
			await withDirectory(config(url, encryption), async () => undefined)
			const create = mocks.state.options?.[factory] as (...args: unknown[]) => unknown
			expect(create(389, 'dc.corp.example')).toBe(socket)
			expect(() => create(389, 'dc.corp.example')).toThrow(/one connection/)
		}
	})

	it('lets a factory open one connection only (decision p)', () => {
		const factory = vi.fn(() => 'socket')
		const once = oncePerClient(factory)
		expect(once(389, 'dc')).toBe('socket')
		expect(() => once(389, 'dc')).toThrow(/one connection/)
		expect(factory).toHaveBeenCalledTimes(1)
		expect(factory).toHaveBeenCalledWith(389, 'dc')
	})
})

describe('withDirectory: failures (decision q)', () => {
	it('unbinds when the work throws, and passes a result code through', async () => {
		const answered = new NoSuchObjectError('no such base')
		await expect(
			withDirectory(config('ldaps://dc', 'ldaps'), async () => {
				throw answered
			}),
		).rejects.toBe(answered)
		expect(mocks.state.calls.at(-1)).toEqual(['unbind'])
	})

	it('makes a refused service bind a DirectoryRefusedError', async () => {
		mocks.state.failAt = {
			step: 'bind',
			error: new InvalidCredentialsError('bad service password'),
		}
		await expect(
			withDirectory(config('ldaps://dc', 'ldaps'), async () => undefined),
		).rejects.toBeInstanceOf(DirectoryRefusedError)
	})

	it('makes a StartTLS the directory refuses a DirectoryRefusedError, and binds nothing (decision u)', async () => {
		mocks.state.failAt = { step: 'startTLS', error: new UnavailableError('TLS not configured') }
		await expect(
			withDirectory(config('ldap://dc', 'starttls'), async () => undefined),
		).rejects.toBeInstanceOf(DirectoryRefusedError)
		expect(mocks.state.calls.map(call => call[0])).toEqual(['startTLS', 'unbind'])
	})

	it('makes a connection or TLS failure a DirectoryUnavailableError, with its cause', async () => {
		const refused = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:389'), {
			code: 'ECONNREFUSED',
			errno: -111,
		})
		mocks.state.failAt = { step: 'startTLS', error: refused }
		const error = await withDirectory(config('ldap://dc', 'starttls'), async () => undefined).catch(
			e => e,
		)
		expect(error).toBeInstanceOf(DirectoryUnavailableError)
		expect((error as Error).cause).toBe(refused)
	})

	it('makes a failure that dropped the connection during the work a DirectoryUnavailableError', async () => {
		const error = await withDirectory(config('ldaps://dc', 'ldaps'), async () => {
			mocks.state.connected = false
			throw new Error('SearchRequest: Operation timed out')
		}).catch(e => e)
		expect(error).toBeInstanceOf(DirectoryUnavailableError)
	})

	it('passes a bug through while still connected', async () => {
		const bug = new TypeError('x is undefined')
		await expect(
			withDirectory(config('ldaps://dc', 'ldaps'), async () => {
				throw bug
			}),
		).rejects.toBe(bug)
	})

	it('reads a missing CA file as a configuration error, before any client exists', async () => {
		const missing = Object.assign(new Error('ENOENT'), { code: 'ENOENT', errno: -2 })
		readFile.mockRejectedValue(missing)
		await expect(withDirectory(config('ldaps://dc', 'ldaps'), async () => undefined)).rejects.toBe(
			missing,
		)
		expect(mocks.state.options).toBeUndefined()
	})
})
