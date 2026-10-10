import 'server-only'

import {
	BusyError,
	ConfidentialityRequiredError,
	InvalidCredentialsError,
	StrongAuthRequiredError,
	UnavailableError,
	type Client,
} from 'ldapts'

import type { GroupLink } from '@/lib/data/directory'
import type { LdapConfig } from '@/lib/env'

import { withDirectory } from './connection'
import { readEntry, type DirectoryEntry } from './entry'
import { DirectoryRefusedError } from './errors'
import { findGroupByKey, findLoginEntries, isMemberOf } from './operations'

export type DirectoryCheck =
	| { ok: true; entry: DirectoryEntry; groupIds: string[] }
	| { ok: false; reason: 'unknown_user' | 'ambiguous_user' | 'invalid_entry' | 'wrong_password' }

/**
 * Spec §6.3 step 4 and §6.5 at sign-in: the hub groups whose links the person is in, nested groups included, each
 * directory group looked up once by its key, while the client is still bound as the service account.
 */
async function linkedGroupsOf(
	client: Client,
	config: LdapConfig,
	userDn: string,
	links: readonly GroupLink[],
): Promise<string[]> {
	const groupIds = new Set<string>()
	for (const [key, groupLinks] of Map.groupBy(links, link => link.directoryGroupId)) {
		const group = await findGroupByKey(client, config, key)
		if (group && (await isMemberOf(client, config, userDn, group.dn)))
			for (const link of groupLinks) groupIds.add(link.groupId)
	}
	return [...groupIds]
}

/**
 * Decision u: busy (51), "the server is too busy to service the operation", and unavailable (52), "the server is shutting
 * down or a subsystem necessary to complete the operation is offline" (RFC 4511 Appendix A), describe the server, not
 * the operation, so either refuses the connection wherever the sign-in meets it, as the service account's bind does
 * (Task 6).
 */
const refusesForTheServer = (error: unknown): boolean =>
	error instanceof BusyError || error instanceof UnavailableError

/** The check on a client bound as the service account; the person's bind is its last step. */
async function checkOn(
	client: Client,
	config: LdapConfig,
	username: string,
	password: string,
	links: readonly GroupLink[],
): Promise<DirectoryCheck> {
	const entries = await findLoginEntries(client, config, username)
	if (entries.length === 0) return { ok: false, reason: 'unknown_user' }
	if (entries.length > 1) return { ok: false, reason: 'ambiguous_user' }
	const entry = readEntry(entries[0]!, config)
	if (!entry) return { ok: false, reason: 'invalid_entry' }
	const groupIds = await linkedGroupsOf(client, config, entry.dn, links)
	try {
		await client.bind(entry.dn, password)
	} catch (error) {
		// Only invalidCredentials (49) is the person's password (Grafana, passport-ldapauth, Mattermost).
		if (error instanceof InvalidCredentialsError) return { ok: false, reason: 'wrong_password' }
		// Decision u: a directory that demands signing or TLS (8, 13) refuses the connection, not the password.
		if (error instanceof StrongAuthRequiredError || error instanceof ConfidentialityRequiredError)
			throw new DirectoryRefusedError({ cause: error })
		throw error
	}
	return { ok: true, entry, groupIds }
}

/**
 * Search, then bind (spec §6.3; the flow of every surveyed project, Apache mod_authnz_ldap "The Authentication Phase":
 * "If the search does not return exactly one entry, deny"). An empty password never reaches a bind (RFC 4513 §5.1.2,
 * §6.3.1; ldapts sends one as it is, `src/messages/BindRequest.ts:31`). One client for the whole check (Task 6); the user's
 * bind is the last step, so nothing runs on the connection once it is bound as the person. A busy or unavailable
 * directory, on a search or on the bind, refuses the connection (decision u); any other result code passes through.
 */
export async function checkDirectoryCredentials(
	config: LdapConfig,
	username: string,
	password: string,
	links: readonly GroupLink[],
): Promise<DirectoryCheck> {
	if (username.trim() === '') return { ok: false, reason: 'unknown_user' }
	if (password === '') return { ok: false, reason: 'wrong_password' }
	return withDirectory(config, async client => {
		try {
			return await checkOn(client, config, username, password, links)
		} catch (error) {
			if (refusesForTheServer(error)) throw new DirectoryRefusedError({ cause: error })
			throw error
		}
	})
}
