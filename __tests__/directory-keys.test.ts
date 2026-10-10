import { describe, expect, it } from 'vitest'

import {
	canonicalKey,
	DIRECTORY_KEY_PATTERN,
	guidBytesToString,
	guidStringToBytes,
	isBinaryKeyAttribute,
	keyFilterValue,
} from '@/lib/directory/keys'

// Microsoft's worked example (archived TechNet wiki on Learn, "Active Directory: LDAP Syntax Filters", note 8): the
// GUID {b95f3990-b59a-4a1b-9e96-86c66cb18d99} is the bytes 90395fb99ab51b4a9e9686c66cb18d99 (MS-DTYP 2.3.4.2:
// Data1, Data2 and Data3 little-endian, Data4 as is).
const bytes = Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex')
const guid = 'b95f3990-b59a-4a1b-9e96-86c66cb18d99'

describe('the objectGUID byte order (MS-DTYP 2.3.4.2)', () => {
	it('turns the 16 bytes into the GUID string and back', () => {
		expect(guidBytesToString(bytes)).toBe(guid)
		expect(guidStringToBytes(guid).equals(bytes)).toBe(true)
	})

	it('refuses anything but 16 bytes or a canonical GUID string', () => {
		expect(() => guidBytesToString(Buffer.alloc(15))).toThrow()
		expect(() => guidStringToBytes('not-a-guid')).toThrow()
	})
})

describe('canonicalKey (spec §6.3 step 6, decision m)', () => {
	it('reads objectGUID from its 16 bytes only', () => {
		expect(isBinaryKeyAttribute('objectGUID')).toBe(true)
		expect(isBinaryKeyAttribute('ObjectGuid')).toBe(true)
		expect(canonicalKey(bytes, 'objectGUID')).toBe(guid)
		expect(canonicalKey([bytes], 'objectGUID')).toBe(guid)
		expect(canonicalKey(Buffer.alloc(8), 'objectGUID')).toBeNull()
		expect(canonicalKey(guid, 'objectGUID')).toBeNull()
		expect(canonicalKey([bytes, bytes], 'objectGUID')).toBeNull()
	})

	// RFC 4530 §2.1: "UUID values are encoded using the [ASCII] character string representation"; RFC 9562 §4 allows
	// either case on input; the hub stores lowercase.
	it('reads entryUUID as text, from a string or its bytes, lowercased', () => {
		expect(isBinaryKeyAttribute('entryUUID')).toBe(false)
		expect(canonicalKey('597AE2F6-16A6-1027-98F4-D28B5365DC14', 'entryUUID')).toBe(
			'597ae2f6-16a6-1027-98f4-d28b5365dc14',
		)
		expect(canonicalKey(Buffer.from('597ae2f6-16a6-1027-98f4-d28b5365dc14'), 'entryUUID')).toBe(
			'597ae2f6-16a6-1027-98f4-d28b5365dc14',
		)
		expect(canonicalKey('uid=alice', 'entryUUID')).toBeNull()
		expect(canonicalKey(Buffer.from([0xff, 0xfe]), 'entryUUID')).toBeNull()
		expect(canonicalKey([], 'entryUUID')).toBeNull()
		expect(canonicalKey(undefined, 'entryUUID')).toBeNull()
	})

	it('matches the canonical pattern the groups form validates against', () => {
		expect(DIRECTORY_KEY_PATTERN.test(guid)).toBe(true)
		expect(DIRECTORY_KEY_PATTERN.test(guid.toUpperCase())).toBe(false)
	})

	it('gives a filter the bytes of a binary key and the text of another', () => {
		expect((keyFilterValue(guid, 'objectGUID') as Buffer).equals(bytes)).toBe(true)
		expect(keyFilterValue('597ae2f6-16a6-1027-98f4-d28b5365dc14', 'entryUUID')).toBe(
			'597ae2f6-16a6-1027-98f4-d28b5365dc14',
		)
	})
})
