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
 * Search, then bind (spec §6.3; the flow of every surveyed project, Apache mod_authnz_ldap "The Authentication Phase":
 * "If the search does not return exactly one entry, deny"). An empty password never reaches a bind (RFC 4513 §5.1.2,
 * §6.3.1; ldapts sends one as it is, `src/messages/BindRequest.ts:31`). One client for the whole check (Task 6); the user's
 * bind is the last step, so nothing runs on the connection once it is bound as the person.
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
		const entries = await findLoginEntries(client, config, username)
		if (entries.length === 0) return { ok: false, reason: 'unknown_user' }
		if (entries.length > 1) return { ok: false, reason: 'ambiguous_user' }
		const entry = readEntry(entries[0]!, config)
		if (!entry) return { ok: false, reason: 'invalid_entry' }
		const groupIds = await linkedGroupsOf(client, config, entry.dn, links)
		try {
			await client.bind(entry.dn, password)
		} catch (error) {
			if (error instanceof InvalidCredentialsError) return { ok: false, reason: 'wrong_password' }
			// Decision u: a directory that demands signing or TLS (8, 13), or is too busy or unavailable (51, 52; RFC 4511
			// Appendix A), refuses the connection, not the password.
			if (
				error instanceof StrongAuthRequiredError ||
				error instanceof ConfidentialityRequiredError ||
				error instanceof BusyError ||
				error instanceof UnavailableError
			)
				throw new DirectoryRefusedError({ cause: error })
			throw error
		}
		return { ok: true, entry, groupIds }
	})
}
