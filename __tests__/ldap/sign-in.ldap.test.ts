import { describe, expect, it } from 'vitest'

import { withDirectory } from '@/lib/directory/connection'
import { searchGroups } from '@/lib/directory/operations'
import { checkDirectoryCredentials } from '@/lib/directory/sign-in'

import { PASSWORD, TEST_DIRECTORIES } from './servers'

describe.each(TEST_DIRECTORIES)(
	'checkDirectoryCredentials: $name',
	({ config, people, groups, emailDomain }) => {
		/** A hub group `hub-g` linked to the named directory group. */
		const linkTo = async (name: string) => {
			const [group] = await withDirectory(config, client => searchGroups(client, config, name))
			return [
				{
					groupId: 'hub-g',
					directoryGroupId: group!.key,
					directoryGroupName: group!.name,
					missingSince: null,
				},
			]
		}

		it('signs a person in and finds the hub group linked to a parent of their group', async () => {
			const check = await checkDirectoryCredentials(
				config,
				people.bob,
				PASSWORD,
				await linkTo(groups.engineering),
			)
			expect(check).toMatchObject({
				ok: true,
				groupIds: ['hub-g'],
				entry: { username: people.bob, email: `bob@${emailDomain}` },
			})
		})

		it('answers no group for a link the person is not in', async () => {
			expect(
				await checkDirectoryCredentials(
					config,
					people.alice,
					PASSWORD,
					await linkTo(groups.engineering),
				),
			).toMatchObject({
				ok: true,
				groupIds: [],
			})
		})

		it('refuses a wrong password, an unknown and a disabled person, and a wildcard', async () => {
			expect(await checkDirectoryCredentials(config, people.alice, 'Wrong-Passw0rd', [])).toEqual({
				ok: false,
				reason: 'wrong_password',
			})
			// Review Focus 1: a password of spaces is a password (decision w): it reaches the bind as typed, and the
			// directory refuses it with invalidCredentials, not as an unauthenticated bind (RFC 4513 §5.1.2).
			expect(await checkDirectoryCredentials(config, people.alice, '   ', [])).toEqual({
				ok: false,
				reason: 'wrong_password',
			})
			expect(await checkDirectoryCredentials(config, 'nobody', PASSWORD, [])).toEqual({
				ok: false,
				reason: 'unknown_user',
			})
			expect(await checkDirectoryCredentials(config, people.carol, PASSWORD, [])).toEqual({
				ok: false,
				reason: 'unknown_user',
			})
			expect(await checkDirectoryCredentials(config, '*', PASSWORD, [])).toEqual({
				ok: false,
				reason: 'unknown_user',
			})
		})

		it('binds a person whose DN carries an escaped comma, and reads an entry without mail as no email', async () => {
			expect(await checkDirectoryCredentials(config, people.frank, PASSWORD, [])).toMatchObject({
				ok: true,
			})
			expect(await checkDirectoryCredentials(config, people.dave, PASSWORD, [])).toMatchObject({
				ok: true,
				entry: { email: null },
			})
		})
	},
)
