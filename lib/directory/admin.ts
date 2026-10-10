import 'server-only'

import { assertAdmin, type SessionUser } from '@/lib/auth/session'

import { directoryConfig } from './config'
import { withDirectory } from './connection'
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
 * The name a picked group's link stores: `directory_group_name` is varchar(255), and MySQL's strict mode refuses a
 * longer value ("values that exceed the column length are not stored, and an error results", MySQL 8.4 "The CHAR and
 * VARCHAR Types"). searchGroups falls back to the DN for a group without a name, so the name is cut here, by code
 * points, as the sync cuts a refreshed name (lib/directory/sync.ts) and readEntry an entry's texts (MDN `Array.from()`:
 * a string's iterator yields code points), which is what the save's zod `max(255)` counts (Zod 4.5 release notes,
 * "String length counts code points").
 */
const LINK_NAME_MAX = 255
const linkName = (name: string): string => Array.from(name).slice(0, LINK_NAME_MAX).join('')

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
	return groups.map(group => ({ key: group.key, name: linkName(group.name) }))
}
