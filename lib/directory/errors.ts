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

/**
 * The directory answered with a result code that refuses the connection, not a person's credentials. Either it refused
 * the connection's set-up: the service account's bind or StartTLS (decision q). Or, during a sign-in, it refused for the
 * connection (decision u): strongerAuthRequired (8) or confidentialityRequired (13) on the person's bind, or busy (51) or
 * unavailable (52) on any of the sign-in's operations, which RFC 4511 Appendix A defines by the server's state.
 */
export class DirectoryRefusedError extends Error {
	constructor(options: { cause: unknown }) {
		super('The directory refused the connection', options)
		this.name = 'DirectoryRefusedError'
	}
}
