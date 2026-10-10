import { describe, expect, it, vi } from 'vitest'

import {
	findGroupByKey,
	findLoginEntries,
	GROUP_SEARCH_LIMIT,
	isMemberOf,
	listMemberKeys,
	listUserEntries,
	PAGE_SIZE,
	searchGroups,
} from '@/lib/directory/operations'

const config = {
	userBaseDn: 'DC=corp',
	groupBaseDn: 'OU=Groups,DC=corp',
	userFilter: '(objectClass=user)',
	loginAttribute: 'sAMAccountName',
	idAttribute: 'objectGUID',
	emailAttribute: 'mail',
	nameAttribute: 'displayName',
	groupFilter: '(objectClass=group)',
	groupNameAttribute: 'cn',
	groupMemberFilter: '(memberOf:1.2.840.113556.1.4.1941:={group_dn})',
} as never
const guid = Buffer.from('90395fb99ab51b4a9e9686c66cb18d99', 'hex')
const clientAnswering = (searchEntries: unknown[]) => {
	const search = vi.fn().mockResolvedValue({ searchEntries, searchReferences: [] })
	return { client: { search } as never, search }
}

describe('the searches name their limits (decision s)', () => {
	it('the login search: two entries at most, no paging', async () => {
		const { client, search } = clientAnswering([])
		await findLoginEntries(client, config, 'alice')
		expect(search).toHaveBeenCalledWith('DC=corp', {
			scope: 'sub',
			filter: '(&(objectClass=user)(sAMAccountName=alice))',
			attributes: ['objectGUID', 'sAMAccountName', 'mail', 'displayName'],
			explicitBufferAttributes: ['objectGUID'],
			sizeLimit: 2,
		})
	})

	it('the user listing: paged and without a size limit', async () => {
		const { client, search } = clientAnswering([])
		await listUserEntries(client, config)
		const [, options] = search.mock.calls[0]
		expect(options).toMatchObject({
			scope: 'sub',
			filter: '(objectClass=user)',
			paged: { pageSize: PAGE_SIZE },
		})
		expect(options).not.toHaveProperty('sizeLimit')
	})

	it('a group by key: its DN and name, or null', async () => {
		const { client, search } = clientAnswering([
			{ dn: 'CN=Eng,OU=Groups,DC=corp', objectGUID: guid, cn: 'Eng' },
		])
		expect(await findGroupByKey(client, config, 'b95f3990-b59a-4a1b-9e96-86c66cb18d99')).toEqual({
			dn: 'CN=Eng,OU=Groups,DC=corp',
			name: 'Eng',
		})
		expect(search.mock.calls[0][0]).toBe('OU=Groups,DC=corp')
		expect(search.mock.calls[0][1]).toMatchObject({
			sizeLimit: 2,
			attributes: ['objectGUID', 'cn'],
		})
		expect(
			await findGroupByKey(
				clientAnswering([]).client,
				config,
				'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
			),
		).toBeNull()
	})

	it('the membership test: the user as base, scope base, no attributes (ADSI "Search Filter Syntax")', async () => {
		const { client, search } = clientAnswering([{ dn: 'CN=Bob,DC=corp' }])
		expect(await isMemberOf(client, config, 'CN=Bob,DC=corp', 'CN=Eng,OU=Groups,DC=corp')).toBe(
			true,
		)
		expect(search).toHaveBeenCalledWith('CN=Bob,DC=corp', {
			scope: 'base',
			filter: '(memberOf:1.2.840.113556.1.4.1941:=CN=Eng,OU=Groups,DC=corp)',
			attributes: ['1.1'],
			sizeLimit: 1,
		})
		expect(await isMemberOf(clientAnswering([]).client, config, 'CN=Bob,DC=corp', 'CN=Eng')).toBe(
			false,
		)
	})

	it('the members of a group: their keys, paged under the user base, invalid keys skipped', async () => {
		const { client, search } = clientAnswering([
			{ dn: 'CN=Bob', objectGUID: guid },
			{ dn: 'CN=Sub', objectGUID: Buffer.alloc(3) },
		])
		expect([...(await listMemberKeys(client, config, 'CN=Eng'))]).toEqual([
			'b95f3990-b59a-4a1b-9e96-86c66cb18d99',
		])
		expect(search.mock.calls[0][1]).toMatchObject({
			paged: { pageSize: PAGE_SIZE },
			attributes: ['objectGUID'],
		})
		expect(search.mock.calls[0][1]).not.toHaveProperty('sizeLimit')
	})

	it('the admin group search: twenty at most, by name', async () => {
		const { client, search } = clientAnswering([
			{ dn: 'CN=Zeta', objectGUID: guid, cn: 'Zeta' },
			{ dn: 'CN=bad', objectGUID: Buffer.alloc(2), cn: 'bad' },
		])
		expect(await searchGroups(client, config, 'eta')).toEqual([
			{ key: 'b95f3990-b59a-4a1b-9e96-86c66cb18d99', name: 'Zeta' },
		])
		expect(search.mock.calls[0][1]).toMatchObject({
			sizeLimit: GROUP_SEARCH_LIMIT,
			filter: '(&(objectClass=group)(cn=*eta*))',
		})
	})
})
