import { describe, expect, it } from 'vitest'

import { withDirectory } from '@/lib/directory/connection'
import { readEntry } from '@/lib/directory/entry'
import { DirectoryRefusedError, DirectoryUnavailableError } from '@/lib/directory/errors'
import {
	findGroupByKey,
	findLoginEntries,
	isMemberOf,
	listMemberKeys,
	listUserEntries,
	searchGroups,
} from '@/lib/directory/operations'

import { adLdaps, adPlain, adStartTls, TEST_DIRECTORIES } from './servers'

// Spec §8: lib/directory/ against the real test directories, in the three working modes.
describe.each(TEST_DIRECTORIES)(
	'the directory connection: $name',
	({ config, people, groups, emailDomain }) => {
		it('finds one entry per login with a canonical key, none for a disabled person or an escaped wildcard', async () => {
			await withDirectory(config, async client => {
				const [alice] = await findLoginEntries(client, config, people.alice)
				const entry = readEntry(alice!, config)
				expect(entry?.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
				expect(entry).toMatchObject({
					username: people.alice,
					email: `alice@${emailDomain}`,
					name: 'Alice Admin',
				})
				expect(await findLoginEntries(client, config, people.carol)).toEqual([])
				// Spec §7.2: the typed value is escaped, so `*` is a literal login, not a wildcard.
				expect(await findLoginEntries(client, config, '*')).toEqual([])
			})
		})

		it("lists every person the filter matches, past the server's size limit (decision l)", async () => {
			const entries = await withDirectory(config, client => listUserEntries(client, config))
			const logins = entries.map(entry => readEntry(entry, config)?.username)
			expect(logins).toEqual(expect.arrayContaining(['alice', 'bob', 'dave', 'erin', 'frank']))
			expect(logins).not.toContain('carol')
			// OpenLDAP lets the service account see five entries per search; a paged search is not capped by the limit:
			// all nine (decision l).
			if (config.idAttribute === 'entryUUID') expect(entries).toHaveLength(9)
		})

		it('finds groups by name and by key, and resolves nested and escaped memberships', async () => {
			await withDirectory(config, async client => {
				const found = await searchGroups(client, config, 'hub-')
				expect(found.map(group => group.name)).toEqual(
					expect.arrayContaining([groups.admins, groups.backend, groups.engineering]),
				)
				const engineering = await findGroupByKey(
					client,
					config,
					found.find(group => group.name === groups.engineering)!.key,
				)
				expect(engineering?.name).toBe(groups.engineering)
				const [bob] = await findLoginEntries(client, config, people.bob)
				// bob is in hub-backend, which is in hub-engineering: the in-chain rule on AD, nestgroup on OpenLDAP.
				expect(await isMemberOf(client, config, bob!.dn, engineering!.dn)).toBe(true)
				expect(
					(await listMemberKeys(client, config, engineering!.dn)).has(readEntry(bob!, config)!.key),
				).toBe(true)
				// A group DN with `(`, `)`, `&` and an escaped comma, and on AD a person DN with one (RFC 4514, RFC 4515).
				const [rnd] = await searchGroups(client, config, 'R&D (Berlin)')
				expect(rnd?.name).toBe(groups.rnd)
				const rndGroup = await findGroupByKey(client, config, rnd!.key)
				const [frank] = await findLoginEntries(client, config, people.frank)
				expect(await isMemberOf(client, config, frank!.dn, rndGroup!.dn)).toBe(true)
				expect(await isMemberOf(client, config, frank!.dn, engineering!.dn)).toBe(false)
			})
		})
	},
)

describe('the directory connection refuses what it must (decision q)', () => {
	it('names an untrusted certificate and a closed port unreachable', async () => {
		await expect(
			withDirectory({ ...adLdaps, caFile: null }, async () => 'never'),
		).rejects.toBeInstanceOf(DirectoryUnavailableError)
		await expect(
			withDirectory({ ...adLdaps, url: 'ldaps://127.0.0.1:1' }, async () => 'never'),
		).rejects.toBeInstanceOf(DirectoryUnavailableError)
	})

	it("names a wrong service password and Samba's refusal of a plain simple bind as refused", async () => {
		await expect(
			withDirectory({ ...adLdaps, bindPassword: 'Wrong-Passw0rd' }, async () => 'never'),
		).rejects.toBeInstanceOf(DirectoryRefusedError)
		// "ldap server require strong auth = yes": strongerAuthRequired (8), as a signing-enforcing AD answers.
		await expect(withDirectory(adPlain, async () => 'never')).rejects.toBeInstanceOf(
			DirectoryRefusedError,
		)
	})

	it("upgrades Samba's port 389 with StartTLS", async () => {
		expect(await withDirectory(adStartTls, async () => 'bound')).toBe('bound')
	})

	// Decision p: ldapts reconnects a client used after unbind() (README "Custom connection factories"), and after
	// StartTLS that reconnect is plain TCP; the hub's client refuses a second connection, in every mode.
	it.each(TEST_DIRECTORIES)('refuses to reconnect a client: $name', async ({ config }) => {
		await expect(
			withDirectory(config, async client => {
				await client.unbind()
				return client.search(config.userBaseDn, { scope: 'base', attributes: ['1.1'] })
			}),
		).rejects.toBeInstanceOf(DirectoryUnavailableError)
	})
})
