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
	const client = new Client({
		url: config.url,
		connectTimeout: CONNECT_TIMEOUT_MS,
		timeout: OPERATION_TIMEOUT_MS,
		...(config.encryption === 'ldaps'
			? { tlsOptions, createSecureConnection: oncePerClient(connectTls) as typeof tls.connect }
			: { createConnection: oncePerClient(connectTcp) as typeof net.connect }),
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
			if (!(error instanceof ResultCodeError) && !client.isConnected)
				throw new DirectoryUnavailableError({ cause: error })
			throw error
		}
	} finally {
		await client.unbind().catch(() => undefined)
	}
}
