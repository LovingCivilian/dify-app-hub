import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { apps } from '@/db/schema'

// Part 1 spec §2.1: the shape of the apps table.
describe('the apps table', () => {
	const config = getTableConfig(apps)
	const column = (name: string) => config.columns.find(entry => entry.name === name)

	it('holds the neutral columns, the provider and its two documents, and no Dify column', () => {
		expect(config.name).toBe('apps')
		expect(config.columns.map(entry => entry.name).sort()).toEqual(
			[
				'access_mode',
				'created_at',
				'description',
				'icon_image',
				'icon_mime',
				'id',
				'is_enabled',
				'name',
				'provider',
				'secrets',
				'settings',
				'tags',
				'updated_at',
			].sort(),
		)
	})
	it('keeps the provider, the documents, the description and the tags NOT NULL, with the spec’s defaults', () => {
		for (const name of ['provider', 'settings', 'secrets', 'description', 'tags'])
			expect(column(name)?.notNull).toBe(true)
		expect(column('provider')?.getSQLType()).toBe('text')
		expect(column('settings')?.getSQLType()).toBe('jsonb')
		expect(column('secrets')?.getSQLType()).toBe('jsonb')
		expect(column('description')?.default).toBe('')
		expect(column('tags')?.default).toEqual([])
	})
	// Decision 24 and spec §4.4: the provider set and the icon pair are checked by the database.
	it('names its two CHECKs', () => {
		expect(config.checks.map(check => check.name).sort()).toEqual([
			'apps_icon_check',
			'apps_provider_check',
		])
	})
})
