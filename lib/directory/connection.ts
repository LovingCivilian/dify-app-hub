import 'server-only'

import { readFile } from 'node:fs/promises'
import net from 'node:net'
import tls from 'node:tls'

import { Client, ResultCodeError } from 'ldapts'

import type { LdapConfig } from '@/lib/env'

import { DirectoryRefusedError, DirectoryUnavailableError } from './errors'

/** Spec §6.2: both timeouts set (ldapts' defaults are off, `src/Client.ts:200-201`); constants, not settings (spec §7.1). */
export const CONNECT_TIMEOUT_MS = 5_000
export const OPERATION_TIMEOUT_MS = 15_000

/**
 * Decision r: TLS 1.2 or later, the CA when set, the URL's host checked by name, and the certificate verified even
 * when the process runs with NODE_TLS_REJECT_UNAUTHORIZED=0 (Node: that variable only changes the default of
 * `rejectUnauthorized`, which an explicit `true` keeps; spec §6.2 "No setting skips certificate verification").
 */
async function tlsOptionsFor(config: LdapConfig): Promise<tls.ConnectionOptions> {
	// WHATWG URL keeps an IPv6 host in brackets; Node wants it bare.
	const host = new URL(config.url).hostname.replace(/^\[(.*)\]$/, '$1')
	return {
		host,
		...(net.isIP(host) === 0 ? { servername: host } : {}),
		minVersion: 'TLSv1.2',
		rejectUnauthorized: true,
		...(config.caFile ? { ca: [await readFile(config.caFile)] } : {}),
	}
}

/**
 * Decision p: a factory that opens one connection, then refuses. Its signature accepts whatever ldapts passes (ldapts
 * calls it "with the parsed port and host", README); a function taking `unknown[]` is assignable to each of the Node
 * factory's overloads, so no overload is guessed.
 */
export function oncePerClient<S>(factory: (...args: unknown[]) => S): (...args: unknown[]) => S {
	let used = false
	return (...args) => {
		if (used) throw new Error('A directory client makes one connection')
		used = true
		return factory(...args)
	}
}
const connectTcp = net.connect as (...args: unknown[]) => net.Socket
const connectTls = tls.connect as (...args: unknown[]) => tls.TLSSocket

/**
 * A fresh client for one sign-in or one sync, bound as the service account, unbound in `finally` (spec §6.2; ldapts
 * README "Authenticate example"). ldaps gives the TLS options to the constructor; StartTLS gives them to `startTLS()`
 * only, since options on the constructor switch ldapts to direct TLS (`src/Client.ts:219-222`); none sends no TLS.
 * Failures are classified by phase (decision q).
 */
export async function withDirectory<T>(
	config: LdapConfig,
	work: (client: Client) => Promise<T>,
): Promise<T> {
	const tlsOptions = config.encryption === 'none' ? undefined : await tlsOptionsFor(config)
	// The sockets the factories opened (decision q). On a reset, ldapts rejects the request in flight before it destroys
	// the socket, and clears `isConnected` only on 'close' (`src/Client.ts:949-1013`); after StartTLS it never does, since
	// those handlers stay on the TCP socket while the client moves to the TLS one (`:282-288`). Node marks a socket
	// `destroyed` as soon as destroy() is called (stream docs, `writable.destroyed`).
	const sockets: net.Socket[] = []
	const opening = <S extends net.Socket>(connect: (...args: unknown[]) => S) =>
		oncePerClient((...args) => {
			const socket = connect(...args)
			sockets.push(socket)
			return socket
		})
	const client = new Client({
		url: config.url,
		connectTimeout: CONNECT_TIMEOUT_MS,
		timeout: OPERATION_TIMEOUT_MS,
		...(config.encryption === 'ldaps'
			? { tlsOptions, createSecureConnection: opening(connectTls) as typeof tls.connect }
			: {
					createConnection: opening(connectTcp) as typeof net.connect,
					// StartTLS upgrades the socket through this factory, once (`startTLS()`, README "Custom connection
					// factories"); plain never calls it.
					...(config.encryption === 'starttls'
						? { createSecureConnection: opening(connectTls) as typeof tls.connect }
						: {}),
				}),
	})
	try {
		try {
			if (config.encryption === 'starttls') await client.startTLS(tlsOptions)
			await client.bind(config.bindDn, config.bindPassword)
		} catch (error) {
			throw error instanceof ResultCodeError
				? new DirectoryRefusedError({ cause: error })
				: new DirectoryUnavailableError({ cause: error })
		}
		try {
			return await work(client)
		} catch (error) {
			const dropped = !client.isConnected || sockets.some(socket => socket.destroyed)
			if (!(error instanceof ResultCodeError) && dropped)
				throw new DirectoryUnavailableError({ cause: error })
			throw error
		}
	} finally {
		// Spec §6.2's unbind() in `finally` releases the connection. A destroyed socket cannot carry the Unbind (RFC 4511
		// §4.3: the client ends the session "upon transmission of the UnbindRequest"), and after StartTLS ldapts would
		// wait the operation timer for one (its 'close' handler, which settles a pending Unbind, sits on the TCP socket
		// and fired at the drop, `src/Client.ts:1015-1030`); the sockets the factories opened are destroyed instead
		// (Node `socket.destroy()`, a no-op on one already destroyed).
		if (sockets.some(socket => socket.destroyed)) for (const socket of sockets) socket.destroy()
		else await client.unbind().catch(() => undefined)
	}
}
