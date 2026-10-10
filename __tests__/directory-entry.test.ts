import { describe, expect, it } from 'vitest'

import { bufferAttributes, cutToColumn, entryAttributes, readEntry } from '@/lib/directory/entry'

const config = {
	idAttribute: 'objectGUID',
	loginAttribute: 'sAMAccountName',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
} as const
const guidBytes = Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex')

describe('readEntry (decision o)', () => {
	it('reads the key, login, email and name, whatever case the server writes the types in', () => {
		expect(
			readEntry(
				{
					dn: 'CN=Alice Admin,CN=Users,DC=corp',
					objectguid: guidBytes,
					SAMACCOUNTNAME: 'alice',
					mail: ['alice@corp.example', 'other@corp.example'],
					displayName: '  Alice Admin ',
				},
				config as never,
			),
		).toEqual({
			dn: 'CN=Alice Admin,CN=Users,DC=corp',
			key: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
			username: 'alice',
			email: 'alice@corp.example',
			name: 'Alice Admin',
		})
	})

	it('answers null without a key or a DN', () => {
		expect(readEntry({ dn: 'CN=x', sAMAccountName: 'x' }, config as never)).toBeNull()
		expect(readEntry({ dn: '', objectGUID: guidBytes }, config as never)).toBeNull()
	})

	it('counts an invalid or missing email as none, and cuts a long name to 255', () => {
		const entry = readEntry(
			{
				dn: 'CN=x',
				objectGUID: guidBytes,
				sAMAccountName: 'x',
				mail: 'not an email',
				displayName: 'n'.repeat(300),
			},
			config as never,
		)
		expect(entry).toMatchObject({ email: null, name: 'n'.repeat(255) })
		// An address over 255 characters is refused whole, never cut into another valid-looking one.
		expect(
			readEntry(
				{ dn: 'CN=x', objectGUID: guidBytes, mail: `${'a'.repeat(239)}@corp.example.org` },
				config as never,
			),
		).toMatchObject({ email: null })
		expect(
			readEntry({ dn: 'CN=x', objectGUID: guidBytes, mail: [] }, config as never),
		).toMatchObject({
			email: null,
			username: null,
			name: null,
		})
	})

	// ldapts hands over a Buffer when its own strict UTF-8 decode failed (src/Attribute.ts); the hub refuses those
	// bytes as canonicalKey does (MDN TextDecoder, `fatal`) rather than store replacement characters.
	it('counts a value that is not UTF-8 as none and reads one that is', () => {
		expect(
			readEntry(
				{
					dn: 'CN=x',
					objectGUID: guidBytes,
					sAMAccountName: Buffer.from([0x61, 0xff]),
					displayName: [Buffer.from([0xc3]), Buffer.from('Zoë')],
				},
				config as never,
			),
		).toMatchObject({ username: null, name: null })
		expect(
			readEntry(
				{ dn: 'CN=x', objectGUID: guidBytes, displayName: Buffer.from('Zoë') },
				config as never,
			),
		).toMatchObject({ name: 'Zoë' })
	})

	// The column holds 255 characters; the cut counts code points, so a character outside the BMP is never split
	// into a lone surrogate (MDN `String.prototype[Symbol.iterator]()`: "surrogate pairs will be preserved").
	it('cuts at a code point, never inside a surrogate pair', () => {
		const name = `${'n'.repeat(254)}😀x`
		expect(
			readEntry({ dn: 'CN=x', objectGUID: guidBytes, displayName: name }, config as never),
		).toMatchObject({ name: `${'n'.repeat(254)}😀` })
	})
})

describe('the attributes a search asks for (spec §6.3 step 3, decision n)', () => {
	it('names the four attributes and asks for the key as a Buffer under both spellings', () => {
		expect(entryAttributes(config as never)).toEqual([
			'objectGUID',
			'sAMAccountName',
			'mail',
			'displayName',
		])
		expect(bufferAttributes({ ...config, idAttribute: 'objectguid' } as never)).toEqual([
			'objectguid',
			'objectGUID',
		])
		expect(bufferAttributes({ ...config, idAttribute: 'entryUUID' } as never)).toEqual([
			'entryUUID',
		])
	})
})

// Task 12 review M4: the one cut the entry, the sync and the group search share (varchar(255), MySQL 8.4).
describe('cutToColumn', () => {
	it('keeps 255 code points, a surrogate pair whole, and leaves a shorter text as it is', () => {
		expect(cutToColumn(`${'n'.repeat(254)}😀x`)).toBe(`${'n'.repeat(254)}😀`)
		expect(Array.from(cutToColumn('😀'.repeat(300)))).toHaveLength(255)
		expect(cutToColumn('Engineering')).toBe('Engineering')
	})
})
