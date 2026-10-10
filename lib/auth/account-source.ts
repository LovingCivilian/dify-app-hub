/**
 * Where an account's identity lives (B3 spec §3.2, ADR-0029): a `local` account signs in with the hub's email and
 * password; an `ldap` account with its directory username and password, which the directory checks, and has no hub
 * password. Client-safe on purpose: the schema, the session types and the users table read it.
 */
export const ACCOUNT_SOURCES = ['local', 'ldap'] as const

export type AccountSource = (typeof ACCOUNT_SOURCES)[number]
