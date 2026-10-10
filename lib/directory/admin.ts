import 'server-only'

import { assertAdmin, type SessionUser } from '@/lib/auth/session'

import { directoryConfig } from './config'
import { withDirectory } from './connection'
import { cutToColumn } from './entry'
import { searchGroups } from './operations'

/*
 * The directory as the admin surface uses it (B3 spec §6.5, §6.6): each function takes the verified actor first and
 * checks admin rights itself, the Data Access Layer's pattern (ADR-0024), before it reaches the directory.
 */

export interface DirectoryGroupOption {
	key: string
	name: string
}

/**
 * Spec §6.5 "Linking": up to twenty directory groups whose name contains the text, or null while LDAP is off (the
 * route answers 409, decision al). Read by GET /api/directory/groups.
 */
export async function searchDirectoryGroups(
	actor: SessionUser,
	text: string,
): Promise<DirectoryGroupOption[] | null> {
	assertAdmin(actor)
	const config = directoryConfig()
	if (!config) return null
	const groups = await withDirectory(config, client => searchGroups(client, config, text))
	// The name a picked group's link stores is varchar(255): searchGroups falls back to the DN for a group without a
	// name, so it is cut here (cutToColumn), before the browser shows it and the save's zod `max(255)` checks it.
	return groups.map(group => ({ key: group.key, name: cutToColumn(group.name) }))
}
