import 'server-only'

import type { Client, Entry } from 'ldapts'

import { DIRECTORY_GROUP_SEARCH_LIMIT } from '@/lib/directory-status'
import type { LdapConfig } from '@/lib/env'

import { attributeValue, bufferAttributes, entryAttributes, firstText } from './entry'
import { groupByKeyFilter, groupSearchFilter, loginFilter, memberFilter } from './filters'
import { canonicalKey } from './keys'

/*
 * The directory searches the hub makes (B3 spec §6.3–§6.5), each with its limits named (decision s). Every filter comes
 * from lib/directory/filters.ts, so every value in it is escaped.
 */

/** Spec §6.4 step 1: under Active Directory's MaxPageSize of 1,000 (MS-ADTS 3.1.1.3.4.6). */
export const PAGE_SIZE = 500

/** Spec §6.5 "Linking": the groups an admin's search shows (the groups page reads the same constant). */
export const GROUP_SEARCH_LIMIT = DIRECTORY_GROUP_SEARCH_LIMIT

/** Spec §6.3 step 3: at most two entries for the login; two means ambiguous. */
export async function findLoginEntries(
	client: Client,
	config: LdapConfig,
	username: string,
): Promise<Entry[]> {
	const { searchEntries } = await client.search(config.userBaseDn, {
		scope: 'sub',
		filter: loginFilter(config, username),
		attributes: entryAttributes(config),
		explicitBufferAttributes: bufferAttributes(config),
		sizeLimit: 2,
	})
	return searchEntries
}

/** Spec §6.4 step 1: every entry the user filter matches, paged, with no size limit (decision s). */
export async function listUserEntries(client: Client, config: LdapConfig): Promise<Entry[]> {
	const { searchEntries } = await client.search(config.userBaseDn, {
		scope: 'sub',
		filter: config.userFilter,
		attributes: entryAttributes(config),
		explicitBufferAttributes: bufferAttributes(config),
		paged: { pageSize: PAGE_SIZE },
	})
	return searchEntries
}

const nameOf = (entry: Entry, attribute: string): string | null =>
	firstText(attributeValue(entry, attribute))

/** Spec §6.4 step 4: a linked group by its key under the group base, or null when it is not found. */
export async function findGroupByKey(
	client: Client,
	config: LdapConfig,
	key: string,
): Promise<{ dn: string; name: string } | null> {
	const { searchEntries } = await client.search(config.groupBaseDn, {
		scope: 'sub',
		filter: groupByKeyFilter(config, key),
		attributes: [config.idAttribute, config.groupNameAttribute],
		explicitBufferAttributes: bufferAttributes(config),
		sizeLimit: 2,
	})
	const [group] = searchEntries
	return searchEntries.length === 1 && group
		? { dn: group.dn, name: nameOf(group, config.groupNameAttribute) ?? group.dn }
		: null
}

/**
 * Spec §6.5 at sign-in: Microsoft's documented test of one user's nested membership (ADSI "Search Filter Syntax",
 * LDAP_MATCHING_RULE_IN_CHAIN: base the user's DN, scope base, the in-chain filter for the group's DN).
 */
export async function isMemberOf(
	client: Client,
	config: LdapConfig,
	userDn: string,
	groupDn: string,
): Promise<boolean> {
	const { searchEntries } = await client.search(userDn, {
		scope: 'base',
		filter: memberFilter(config, groupDn),
		attributes: ['1.1'],
		sizeLimit: 1,
	})
	return searchEntries.length > 0
}

/** Spec §6.4 step 4: the keys of the entries the member filter matches for the group, paged under the user base. */
export async function listMemberKeys(
	client: Client,
	config: LdapConfig,
	groupDn: string,
): Promise<Set<string>> {
	const { searchEntries } = await client.search(config.userBaseDn, {
		scope: 'sub',
		filter: memberFilter(config, groupDn),
		attributes: [config.idAttribute],
		explicitBufferAttributes: bufferAttributes(config),
		paged: { pageSize: PAGE_SIZE },
	})
	const keys = new Set<string>()
	for (const entry of searchEntries) {
		const key = canonicalKey(attributeValue(entry, config.idAttribute), config.idAttribute)
		if (key) keys.add(key)
	}
	return keys
}

/** Spec §6.5 "Linking": up to twenty groups whose name contains the text, by name; entries without a valid key are left out. */
export async function searchGroups(
	client: Client,
	config: LdapConfig,
	text: string,
): Promise<{ key: string; name: string }[]> {
	const { searchEntries } = await client.search(config.groupBaseDn, {
		scope: 'sub',
		filter: groupSearchFilter(config, text),
		attributes: [config.idAttribute, config.groupNameAttribute],
		explicitBufferAttributes: bufferAttributes(config),
		sizeLimit: GROUP_SEARCH_LIMIT,
	})
	return searchEntries
		.flatMap(entry => {
			const key = canonicalKey(attributeValue(entry, config.idAttribute), config.idAttribute)
			return key ? [{ key, name: nameOf(entry, config.groupNameAttribute) ?? entry.dn }] : []
		})
		.sort((a, b) => a.name.localeCompare(b.name))
}
