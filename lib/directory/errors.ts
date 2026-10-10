import 'server-only'

/*
 * The directory's failures as the hub tells them apart (B3 spec §7.3, decision q). No ldapts import, so lib/error-log.ts,
 * the `ldap` provider, the sync and the groups page's search route tell them apart without reaching into the client.
 */

/** The directory did not answer: a refused or dropped connection, a TLS failure, a timeout. */
export class DirectoryUnavailableError extends Error {
	constructor(options: { cause: unknown }) {
		super('The directory is unreachable', options)
		this.name = 'DirectoryUnavailableError'
	}
}

/** The directory answered the connection's set-up with a result code: the service account's bind or StartTLS refused. */
export class DirectoryRefusedError extends Error {
	constructor(options: { cause: unknown }) {
		super('The directory refused the service account', options)
		this.name = 'DirectoryRefusedError'
	}
}
