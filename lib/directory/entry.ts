import 'server-only'

import type { Entry } from 'ldapts'

import { emailField } from '@/lib/auth/fields'
import type { LdapConfig } from '@/lib/env'

import { canonicalKey, isBinaryKeyAttribute } from './keys'

type EntryConfig = Pick<
	LdapConfig,
	'idAttribute' | 'loginAttribute' | 'emailAttribute' | 'nameAttribute'
>

/** A directory entry as the hub reads it (spec §6.3 step 6). */
export interface DirectoryEntry {
	dn: string
	key: string
	username: string | null
	email: string | null
	name: string | null
}

/** Spec §6.3 step 3: the id, login, email and name attributes, by name (an operational one is returned only so, RFC 4512 §3.4). */
export const entryAttributes = (config: EntryConfig): string[] => [
	config.idAttribute,
	config.loginAttribute,
	config.emailAttribute,
	config.nameAttribute,
]

/** Spec §6.3 step 3 and decision n: the key as a Buffer always, `objectGUID` under its schema spelling too. */
export const bufferAttributes = (config: Pick<LdapConfig, 'idAttribute'>): string[] => [
	...new Set([
		config.idAttribute,
		...(isBinaryKeyAttribute(config.idAttribute) ? ['objectGUID'] : []),
	]),
]

const COLUMN_MAX = 255

/** UTF-8 that refuses invalid bytes (MDN `TextDecoder`, `fatal`), as canonicalKey reads a text key. */
const utf8 = new TextDecoder('utf-8', { fatal: true })

/** An attribute's value whatever the case of its type (RFC 4512 §2.5; decision o). */
export const attributeValue = (entry: Entry, attribute: string): unknown => {
	const wanted = attribute.toLowerCase()
	const key = Object.keys(entry).find(name => name !== 'dn' && name.toLowerCase() === wanted)
	return key === undefined ? undefined : entry[key]
}

/** A Buffer's text, or null when it is not UTF-8 (ldapts hands over a Buffer when its own strict decode failed). */
const decode = (bytes: Buffer): string | null => {
	try {
		return utf8.decode(bytes)
	} catch {
		return null
	}
}

/** The first value as trimmed text, or null; a Buffer is read as strict UTF-8, and one that is not counts as none. */
const firstValue = (value: unknown): string | null => {
	const first = Array.isArray(value) ? value[0] : value
	const text = Buffer.isBuffer(first) ? decode(first) : typeof first === 'string' ? first : null
	const trimmed = text?.trim() ?? ''
	return trimmed === '' ? null : trimmed
}

/**
 * The first value as trimmed text cut to its column's 255 characters, or null. The cut counts code points:
 * `Array.from` takes a string's iterator (MDN `Array.from()`), which yields code points, so "surrogate pairs will be
 * preserved" (MDN `String.prototype[Symbol.iterator]()`).
 */
export const firstText = (value: unknown): string | null => {
	const text = firstValue(value)
	return text === null ? null : Array.from(text).slice(0, COLUMN_MAX).join('')
}

/** The entry as the hub keeps it, or null when it has no DN or no valid key (spec §6.3 step 6). */
export function readEntry(entry: Entry, config: EntryConfig): DirectoryEntry | null {
	const key = canonicalKey(attributeValue(entry, config.idAttribute), config.idAttribute)
	if (!entry.dn || key === null) return null
	// Checked whole: a cut address would be another address (emailField refuses one over 255 characters).
	const email = firstValue(attributeValue(entry, config.emailAttribute))
	return {
		dn: entry.dn,
		key,
		username: firstText(attributeValue(entry, config.loginAttribute)),
		email: email !== null && emailField.safeParse(email).success ? email : null,
		name: firstText(attributeValue(entry, config.nameAttribute)),
	}
}
