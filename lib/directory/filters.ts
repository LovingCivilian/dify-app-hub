import 'server-only'

import { AndFilter, EqualityFilter, Filter, FilterParser } from 'ldapts'

import { GROUP_DN_PLACEHOLDER, type LdapConfig } from '@/lib/env'

import { keyFilterValue } from './keys'

/*
 * The filters the hub sends (B3 spec §6.3–§6.5, §7.2). The configured parts (filters, attribute names) were validated
 * by lib/env.ts; every value from a person or from the directory goes through ldapts' `Filter.escape` (ldapts README
 * "Filter Strings"; RFC 4515 §3), never into the filter as written; a binary key travels as its bytes in a filter
 * object (groupByKeyFilter).
 */

type FilterConfig = Pick<
	LdapConfig,
	| 'userFilter'
	| 'loginAttribute'
	| 'idAttribute'
	| 'groupFilter'
	| 'groupNameAttribute'
	| 'groupMemberFilter'
>

/** Spec §6.3 step 3: `(&<LDAP_USER_FILTER>(<LDAP_LOGIN_ATTRIBUTE>=<username>))`. */
export const loginFilter = (config: FilterConfig, username: string): string =>
	`(&${config.userFilter}(${config.loginAttribute}=${Filter.escape(username)}))`

/** Spec §6.5: LDAP_GROUP_MEMBER_FILTER with the group's DN, escaped (a DN often carries RFC 4514 backslashes). */
export const memberFilter = (config: FilterConfig, groupDn: string): string =>
	config.groupMemberFilter.replaceAll(GROUP_DN_PLACEHOLDER, Filter.escape(groupDn))

/**
 * Spec §6.4 step 4: a linked group by its key under the group filter. A filter object, not a string (spec §6.3 step 3
 * names ldapts' filter classes beside `escapeFilter`): `search()` reads a string filter's `\XX` escapes as one character
 * each and writes the value as UTF-8 (ldapts 9.2.0 `FilterParser._unescapeHexValues`, `BerWriter.writeString`), so a
 * binary key's bytes from 0x80 up would go out as two bytes each and match nothing. An `EqualityFilter` with a Buffer
 * value carries the 16 bytes as they are, the assertion's OCTET STRING (RFC 4511 §4.1.6; `EqualityFilter.writeFilter`).
 */
export const groupByKeyFilter = (config: FilterConfig, key: string): Filter =>
	new AndFilter({
		filters: [
			FilterParser.parseString(config.groupFilter),
			new EqualityFilter({
				attribute: config.idAttribute,
				value: keyFilterValue(key, config.idAttribute),
			}),
		],
	})

/** Spec §6.5 "Linking": the groups whose name contains the text. */
export const groupSearchFilter = (config: FilterConfig, text: string): string =>
	`(&${config.groupFilter}(${config.groupNameAttribute}=*${Filter.escape(text)}*))`
