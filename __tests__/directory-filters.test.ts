import {
	AndFilter,
	BerWriter,
	EqualityFilter,
	ExtensibleFilter,
	FilterParser,
	SubstringFilter,
	type Filter,
} from 'ldapts'
import { describe, expect, it } from 'vitest'

import {
	groupByKeyFilter,
	groupSearchFilter,
	loginFilter,
	memberFilter,
} from '@/lib/directory/filters'

const config = {
	userFilter: '(&(objectCategory=person)(objectClass=user))',
	loginAttribute: 'sAMAccountName',
	idAttribute: 'objectGUID',
	groupFilter: '(objectClass=group)',
	groupNameAttribute: 'cn',
	groupMemberFilter: '(memberOf:1.2.840.113556.1.4.1941:={group_dn})',
}

// RFC 4515 §3 and ldapts' Filter.escape: `*`, `(`, `)`, `\` and NUL become \2a \28 \29 \5c \00; OWASP LDAP Injection
// Prevention Cheat Sheet: "Escape all variables using the right LDAP encoding function".
describe('loginFilter (spec §6.3 step 3)', () => {
	it('ANDs the user filter with the escaped login', () => {
		expect(loginFilter(config, 'alice')).toBe(
			'(&(&(objectCategory=person)(objectClass=user))(sAMAccountName=alice))',
		)
	})

	it.each([
		['*', '\\2a'],
		['alice)(objectClass=*', 'alice\\29\\28objectClass=\\2a'],
		['a\\b', 'a\\5cb'],
		['a\u0000b', 'a\\00b'],
	])('escapes %j', (username, escaped) => {
		const filter = loginFilter(config, username)
		expect(filter).toBe(
			`(&(&(objectCategory=person)(objectClass=user))(sAMAccountName=${escaped}))`,
		)
		// Review Focus 1: ldapts reads the filter back with the login as one equality value, the text as typed, never a
		// presence or substring filter or a second part.
		const parsed = FilterParser.parseString(filter)
		expect(parsed).toBeInstanceOf(AndFilter)
		const [, login] = (parsed as AndFilter).filters
		expect(login).toBeInstanceOf(EqualityFilter)
		expect((login as EqualityFilter).value).toBe(username)
	})
})

describe('memberFilter (spec §6.5)', () => {
	it('puts the escaped DN in place of {group_dn}', () => {
		expect(memberFilter(config, 'CN=Smith\\, John,OU=Groups,DC=corp')).toBe(
			'(memberOf:1.2.840.113556.1.4.1941:=CN=Smith\\5c, John,OU=Groups,DC=corp)',
		)
	})

	// A string replacement would read `$'`, `` $` ``, `$&` and `$$` in the DN as patterns (MDN String.prototype.replace,
	// "Specifying a string as the replacement"); the DN must reach the filter as the directory gave it.
	it.each([
		["CN=Fun$'Group,OU=Groups,DC=corp"],
		['CN=Sales$&Marketing,OU=Groups,DC=corp'],
		['CN=Cash$$,OU=Groups,DC=corp'],
		['CN=a$`b,OU=Groups,DC=corp'],
	])('keeps the $ sequences of %j as they are', groupDn => {
		const filter = memberFilter(config, groupDn)
		expect(filter).toBe(`(memberOf:1.2.840.113556.1.4.1941:=${groupDn})`)
		const parsed = FilterParser.parseString(filter)
		expect(parsed).toBeInstanceOf(ExtensibleFilter)
		expect((parsed as ExtensibleFilter).value).toBe(groupDn)
	})
})

describe('groupByKeyFilter (spec §6.4 step 4)', () => {
	const bytes = Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex')
	/** The filter as ldapts' search() sends it (the BER of the request's filter). */
	const encoded = (filter: Filter) => {
		const writer = new BerWriter()
		filter.write(writer)
		return writer.buffer
	}

	it('sends a binary key as its 16 bytes (decision m)', () => {
		const filter = groupByKeyFilter(config, 'b95f3990-b59a-4a1b-9e96-86c66cb18d99')
		expect(filter.toString()).toBe(
			'(&(objectClass=group)(objectGUID=\\90\\39\\5f\\b9\\9a\\b5\\1b\\4a\\9e\\96\\86\\c6\\6c\\b1\\8d\\99))',
		)
		// The assertion value is an OCTET STRING of 16 bytes (0x04 0x10, RFC 4511 §4.1.6), the key's own bytes.
		expect(encoded(filter).includes(Buffer.concat([Buffer.from([0x04, 0x10]), bytes]))).toBe(true)
		// The same filter as a string would not carry them: ldapts 9.2.0 writes \90 as the UTF-8 of U+0090 (c2 90).
		expect(encoded(FilterParser.parseString(filter.toString())).includes(bytes)).toBe(false)
	})

	it('compares a text key as text', () => {
		expect(
			groupByKeyFilter(
				{ ...config, idAttribute: 'entryUUID' },
				'597ae2f6-16a6-1027-98f4-d28b5365dc14',
			).toString(),
		).toBe('(&(objectClass=group)(entryUUID=597ae2f6-16a6-1027-98f4-d28b5365dc14))')
	})
})

describe('groupSearchFilter (spec §6.5 "Linking")', () => {
	it('searches the name attribute for the escaped text anywhere', () => {
		const filter = groupSearchFilter(config, 'eng*')
		expect(filter).toBe('(&(objectClass=group)(cn=*eng\\2a*))')
		// The admin's `*` stays a literal inside the one substring part, never a wildcard of its own.
		const [, name] = (FilterParser.parseString(filter) as AndFilter).filters
		expect(name).toBeInstanceOf(SubstringFilter)
		expect(name).toMatchObject({ attribute: 'cn', initial: '', any: ['eng*'], final: '' })
	})
})
