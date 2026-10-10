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

/** The directory settings the hub can check only by using them (a file to read); lib/env.ts checks the rest. */
export type DirectorySetting = 'LDAP_CA_FILE'

/**
 * A directory setting the hub cannot use, found before any connection to the directory (final review I1): the CA file
 * of `LDAP_CA_FILE` that cannot be read. The log names the setting and the cause's code only (lib/error-log.ts): Node's file error
 * carries the path in `path` and in its message (Node "Class: SystemError"), and the OWASP Logging Cheat Sheet lists
 * file paths among the data to treat with care before logging. The sign-in answers `Default`, the sync records
 * `internal_error` and the groups route answers 500, as for any other error that is not the directory's.
 */
export class DirectoryConfigError extends Error {
	readonly setting: DirectorySetting

	constructor(setting: DirectorySetting, options: { cause: unknown }) {
		super(`${setting} cannot be read`, options)
		this.name = 'DirectoryConfigError'
		this.setting = setting
	}
}
