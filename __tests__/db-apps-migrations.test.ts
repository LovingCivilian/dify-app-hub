import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const folders = readdirSync('db/migrations').sort()
const sqlOf = (suffix: string) => {
	const folder = folders.find(name => name.endsWith(`_${suffix}`))
	expect(folder).toBeDefined()
	return readFileSync(path.join('db/migrations', folder!, 'migration.sql'), 'utf8')
}

// Part 1 spec §2.4 and Plan decision b: expand (generated), data (custom), contract (generated), in that order.
describe("Part 1's migrations", () => {
	it('follow the baseline as expand, data and contract', () => {
		expect(folders.map(name => name.replace(/^\d{14}_/, ''))).toEqual([
			'baseline',
			'apps_expand',
			'apps_data',
			'apps_contract',
		])
	})
	// A rename keeps the rows and the grants' foreign keys; a drop and create would lose them (Review Focus 2).
	it('rename dify_apps to apps and add the three columns as NULL-able first', () => {
		const sql = sqlOf('apps_expand')
		expect(sql).toContain('ALTER TABLE "dify_apps" RENAME TO "apps";')
		expect(sql).toContain('ALTER TABLE "apps" ADD COLUMN "provider" text;')
		expect(sql).toContain('ALTER TABLE "apps" ADD COLUMN "settings" jsonb;')
		expect(sql).toContain('ALTER TABLE "apps" ADD COLUMN "secrets" jsonb;')
		expect(sql).not.toMatch(/DROP TABLE|CREATE TABLE/)
	})
	it('fill the documents from the Part 0 columns before anything is dropped', () => {
		const sql = sqlOf('apps_data')
		expect(sql).toContain(`"provider" = 'dify'`)
		expect(sql).toContain(`'appType', "mode"`)
		expect(sql).toContain(`"secrets" = jsonb_build_object('apiKey', "api_key")`)
		expect(sql).not.toMatch(/DROP|ALTER/)
	})
	it('then add the constraints and drop the eleven Part 0 columns', () => {
		const sql = sqlOf('apps_contract')
		expect(sql).toContain(
			`ALTER TABLE "apps" ADD CONSTRAINT "apps_provider_check" CHECK ("provider" IN ('dify'));`,
		)
		expect(sql).toContain(
			'ALTER TABLE "apps" ADD CONSTRAINT "apps_icon_check" CHECK (("icon_image" IS NULL) = ("icon_mime" IS NULL));',
		)
		for (const name of [
			'mode',
			'api_base',
			'api_key',
			'enable_answer_form',
			'answer_form_feedback_text',
			'enable_update_input_after_starts',
			'opening_statement_display_mode',
			'enable_annotation',
			'icon_type',
			'icon',
			'icon_background',
		])
			expect(sql).toContain(`ALTER TABLE "apps" DROP COLUMN "${name}";`)
		for (const name of ['provider', 'settings', 'secrets', 'description', 'tags'])
			expect(sql).toContain(`ALTER TABLE "apps" ALTER COLUMN "${name}" SET NOT NULL;`)
	})
})
