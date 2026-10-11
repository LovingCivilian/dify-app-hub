import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import { instanceSettingFiles, instanceSettings } from '@/db/schema'

describe('the settings schema (settings spec §3.2)', () => {
	it('keys instance_settings by area, stores a jsonb document, and keeps who saved it without a foreign key', () => {
		const config = getTableConfig(instanceSettings)
		expect(config.name).toBe('instance_settings')
		expect(instanceSettings.area.primary).toBe(true)
		expect(instanceSettings.area.getSQLType()).toBe('text')
		expect(instanceSettings.data.getSQLType()).toBe('jsonb')
		expect(instanceSettings.data.notNull).toBe(true)
		expect(instanceSettings.updatedBy.getSQLType()).toBe('uuid')
		expect(instanceSettings.updatedBy.notNull).toBe(false)
		// As users.admin_deactivated_by (B3 spec §3.1): deleting the saving account keeps the record.
		expect(config.foreignKeys).toEqual([])
	})

	it('keys instance_setting_files by area and name and deletes them with their area', () => {
		const config = getTableConfig(instanceSettingFiles)
		expect(config.name).toBe('instance_setting_files')
		const [primary] = config.primaryKeys
		expect(primary.columns.map(column => column.name)).toEqual(['area', 'name'])
		const [foreignKey] = config.foreignKeys
		expect(foreignKey.onDelete).toBe('cascade')
		expect(foreignKey.reference().foreignTable).toBe(instanceSettings)
		expect(instanceSettingFiles.bytes.getSQLType()).toBe('bytea')
		expect(instanceSettingFiles.mime.notNull).toBe(true)
	})
})
