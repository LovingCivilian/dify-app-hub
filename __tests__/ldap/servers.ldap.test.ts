import { readFileSync } from 'node:fs'

import { SizeLimitExceededError } from 'ldapts'
import { describe, expect, it } from 'vitest'

import { openldapPlain, rawClient, TEST_DIRECTORIES } from './servers'

// The harness itself (decision k): each directory answers a service bind and a search in its mode.
describe.each(TEST_DIRECTORIES)('the test directory: $name', ({ config, people }) => {
	it('binds as the service account and finds a seeded person', async () => {
		const client = rawClient(config)
		try {
			const ca = [readFileSync(config.caFile!)]
			if (config.encryption === 'starttls') await client.startTLS({ ca, host: '127.0.0.1' })
			await client.bind(config.bindDn, config.bindPassword)
			const { searchEntries } = await client.search(config.userBaseDn, {
				filter: `(${config.loginAttribute}=${people.alice})`,
				attributes: [config.loginAttribute],
			})
			expect(searchEntries).toHaveLength(1)
		} finally {
			await client.unbind()
		}
	})
})

// Spec §8: OpenLDAP's per-account size limit forces the sync to page (decision l).
describe("OpenLDAP's limit for the service account", () => {
	it('refuses an unpaged search over five entries', async () => {
		const client = rawClient(openldapPlain)
		try {
			await client.bind(openldapPlain.bindDn, openldapPlain.bindPassword)
			await expect(
				client.search(openldapPlain.userBaseDn, {
					filter: openldapPlain.userFilter,
					attributes: ['uid'],
				}),
			).rejects.toBeInstanceOf(SizeLimitExceededError)
		} finally {
			await client.unbind()
		}
	})
})
