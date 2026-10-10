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
	readCaFile,
	withDirectory,
} from '@/lib/directory/connection'
import {
	DirectoryConfigError,
	DirectoryRefusedError,
	DirectoryUnavailableError,
} from '@/lib/directory/errors'

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
		expect(mocks.state.options).not.toHaveProperty('createSecureConnection')
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
			// The StartTLS upgrade's factory: ldapts calls it once per startTLS() (README "Custom connection factories").
			['ldap://dc.corp.example:389', 'starttls', 'createSecureConnection', 'tls socket'],
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

	// The socket the work runs on, by mode: the direct TLS one, the StartTLS upgrade's, the plain one.
	const workSockets = [
		{
			url: 'ldaps://dc',
			encryption: 'ldaps',
			factory: 'createSecureConnection',
			connect: sockets.tls,
		},
		{
			url: 'ldap://dc',
			encryption: 'starttls',
			factory: 'createSecureConnection',
			connect: sockets.tls,
		},
		{ url: 'ldap://dc', encryption: 'none', factory: 'createConnection', connect: sockets.tcp },
	] as const
	/** Opens the connection through the factory the client was given, as ldapts does, and answers its socket. */
	const openThroughFactory = (
		factory: string,
		connect: (typeof workSockets)[number]['connect'],
	) => {
		const socket = { destroyed: false, destroy: vi.fn() }
		connect.mockReturnValueOnce(socket as never)
		const create = mocks.state.options?.[factory] as (...args: unknown[]) => unknown
		create(389, 'dc')
		return socket
	}

	// A reset (ECONNRESET): ldapts rejects the request in flight before its 'close' handler clears `connected`, and
	// after StartTLS that handler stays on the TCP socket; the socket the hub's factory opened is already destroyed.
	it.each(workSockets)(
		'makes a failure on a destroyed socket a DirectoryUnavailableError while ldapts still reports connected: $encryption',
		async ({ url, encryption, factory, connect }) => {
			const error = await withDirectory(config(url, encryption), async () => {
				openThroughFactory(factory, connect).destroyed = true
				throw new Error('Socket error. Message type: SearchRequest (0x63)')
			}).catch(e => e)
			expect(mocks.state.connected).toBe(true)
			expect(error).toBeInstanceOf(DirectoryUnavailableError)
			// A dead socket cannot carry the Unbind, so none is sent (RFC 4511 §4.3).
			expect(mocks.state.calls).not.toContainEqual(['unbind'])
		},
	)

	// After StartTLS, ldapts would wait the operation timer for an Unbind on the dead TLS socket: its 'close' handler,
	// the one that settles a pending Unbind, sits on the TCP socket and fired at the drop.
	it('releases a dead StartTLS connection without an Unbind, destroying every socket it opened', async () => {
		const tcp = { destroyed: false, destroy: vi.fn() }
		const secure = { destroyed: false, destroy: vi.fn() }
		sockets.tcp.mockReturnValueOnce(tcp as never)
		sockets.tls.mockReturnValueOnce(secure as never)
		await withDirectory(config('ldap://dc', 'starttls'), async () => {
			const options = mocks.state.options as Record<string, (...args: unknown[]) => unknown>
			options.createConnection(389, 'dc')
			options.createSecureConnection({ socket: tcp })
			secure.destroyed = true
			throw new Error('Connection closed before message response was received.')
		}).catch(() => undefined)
		expect(mocks.state.calls.map(call => call[0])).toEqual(['startTLS', 'bind'])
		expect(tcp.destroy).toHaveBeenCalledOnce()
	})

	it.each(workSockets)(
		'passes a bug through on a socket that is still open: $encryption',
		async ({ url, encryption, factory, connect }) => {
			const bug = new TypeError('x is undefined')
			await expect(
				withDirectory(config(url, encryption), async () => {
					openThroughFactory(factory, connect)
					throw bug
				}),
			).rejects.toBe(bug)
			// A live connection is released by its Unbind, as spec §6.2 asks.
			expect(mocks.state.calls.at(-1)).toEqual(['unbind'])
		},
	)

	// Final review I1: Node's error names the path (`path`, and the message; Node "Class: SystemError"), so the read
	// failure is wrapped in an error that names the setting instead, which lib/error-log.ts reduces to its code.
	it.each([
		['ldaps://dc.corp.example:636', 'ldaps'],
		['ldap://dc.corp.example:389', 'starttls'],
	] as const)(
		'%s (%s): an unreadable CA file is a DirectoryConfigError naming LDAP_CA_FILE, before any client exists',
		async (url, encryption) => {
			const missing = Object.assign(
				new Error("ENOENT: no such file or directory, open '/run/ca.pem'"),
				{ code: 'ENOENT', errno: -2, syscall: 'open', path: '/run/ca.pem' },
			)
			readFile.mockRejectedValue(missing)
			const failure = withDirectory(config(url, encryption), async () => undefined)
			await expect(failure).rejects.toBeInstanceOf(DirectoryConfigError)
			await expect(failure).rejects.toMatchObject({
				name: 'DirectoryConfigError',
				setting: 'LDAP_CA_FILE',
				cause: missing,
			})
			expect(readFile).toHaveBeenCalledWith('/run/ca.pem')
			expect(mocks.state.options).toBeUndefined()
			expect(mocks.state.calls).toEqual([])
		},
	)
})

describe('readCaFile (final review I1)', () => {
	it('answers the file as read', async () => {
		await expect(readCaFile('/run/ca.pem')).resolves.toEqual(Buffer.from('PEM'))
		expect(readFile).toHaveBeenCalledWith('/run/ca.pem')
	})

	it('wraps any failed read, a directory given as the file included', async () => {
		const directory = Object.assign(new Error('EISDIR: illegal operation on a directory, read'), {
			code: 'EISDIR',
			errno: -21,
			syscall: 'read',
		})
		readFile.mockRejectedValue(directory)
		await expect(readCaFile('/run/secrets')).rejects.toMatchObject({
			name: 'DirectoryConfigError',
			setting: 'LDAP_CA_FILE',
			message: 'LDAP_CA_FILE cannot be read',
			cause: directory,
		})
	})
})
