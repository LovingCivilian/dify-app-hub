import 'server-only'

import { DIRECTORY_KEY_PATTERN } from '@/lib/directory-status'

/*
 * A directory entry's key (B3 spec §3.2, §6.3 step 6): the only link between an account and its entry (ADR-0026),
 * stored as lowercase GUID text. `objectGUID` arrives as 16 bytes in Microsoft's byte order; `entryUUID` as text.
 */

/** The canonical key text (Task 1's client-safe vocabulary, so the groups form shares it). */
export { DIRECTORY_KEY_PATTERN }

/** Decision m: binary when the id attribute is `objectGUID`, compared without case (Keycloak's `isObjectGUID`). */
export const isBinaryKeyAttribute = (attribute: string): boolean =>
	attribute.toLowerCase() === 'objectguid'

/**
 * MS-DTYP 2.3.4.2: Data1 (4 bytes), Data2 (2) and Data3 (2) are little-endian and Data4 (8) is kept as it is, so the
 * first three groups are written byte-reversed (.NET `Guid.ToByteArray`: "The order of the beginning four-byte group
 * and the next two two-byte groups is reversed").
 */
export function guidBytesToString(bytes: Buffer): string {
	if (bytes.length !== 16) throw new Error('objectGUID must be 16 bytes')
	const h = bytes.toString('hex')
	return (
		`${h.slice(6, 8)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}-${h.slice(10, 12)}${h.slice(8, 10)}-` +
		`${h.slice(14, 16)}${h.slice(12, 14)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
	)
}

/** The reverse of guidBytesToString: the 16 bytes a filter compares `objectGUID` with (spec §6.4 step 4). */
export function guidStringToBytes(key: string): Buffer {
	if (!DIRECTORY_KEY_PATTERN.test(key)) throw new Error('not a canonical GUID')
	const h = key.replaceAll('-', '')
	return Buffer.from(
		`${h.slice(6, 8)}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}${h.slice(10, 12)}${h.slice(8, 10)}` +
			`${h.slice(14, 16)}${h.slice(12, 14)}${h.slice(16, 32)}`,
		'hex',
	)
}

/** UTF-8 that refuses invalid bytes (MDN `TextDecoder`, `fatal`). */
const utf8 = new TextDecoder('utf-8', { fatal: true })

/**
 * The canonical key of an entry's id value, or null when it is not one (the sign-in refuses it, the sync skips it):
 * exactly one value; for `objectGUID` 16 bytes; otherwise text, from a string or UTF-8 bytes, in UUID form.
 */
export function canonicalKey(value: unknown, attribute: string): string | null {
	const single = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value
	if (isBinaryKeyAttribute(attribute))
		return Buffer.isBuffer(single) && single.length === 16 ? guidBytesToString(single) : null
	let text: string | null = null
	if (typeof single === 'string') text = single
	else if (Buffer.isBuffer(single)) {
		try {
			text = utf8.decode(single)
		} catch {
			return null
		}
	}
	const lower = text?.trim().toLowerCase() ?? ''
	return DIRECTORY_KEY_PATTERN.test(lower) ? lower : null
}

/** What a filter compares the id attribute with: a binary key's 16 bytes, else its text (decision m). */
export const keyFilterValue = (key: string, attribute: string): Buffer | string =>
	isBinaryKeyAttribute(attribute) ? guidStringToBytes(key) : key
