import { readMigrationFiles } from 'drizzle-orm/migrator'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
 * Part 1 spec §9: the migration runs against a database seeded in Part 0's shape. Its own database in the e2e PostgreSQL
 * (`hub_migration`, as global-setup.ts makes hub_dal): the baseline's statements, then Part 0 rows, then Part 1's three
 * migrations in one transaction, as the migrator applies pending migrations (DV 1d). The statements are the migrator's
 * own reading of the folder (drizzle-orm `readMigrationFiles`: the files sorted by name, split at `--> statement-breakpoint`).
 */
const ADMIN_URL = 'postgres://e2e:e2e@127.0.0.1:5433/e2e'
const MIGRATION_URL = 'postgres://e2e:e2e@127.0.0.1:5433/hub_migration'
const [baseline, ...part1] = readMigrationFiles({ migrationsFolder: 'db/migrations' })

const EMOJI_APP = 'a0000000-0000-4000-8000-000000000001'
const IMAGE_APP = 'a0000000-0000-4000-8000-000000000002'
const NO_MODE_APP = 'a0000000-0000-4000-8000-000000000003'
const USER = '11111111-1111-4111-8111-111111111111'
const GROUP = '22222222-2222-4222-8222-222222222222'
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

const admin = async (statement: string) => {
	const client = new Client({ connectionString: ADMIN_URL })
	await client.connect()
	try {
		await client.query(statement)
	} finally {
		await client.end()
	}
}
let db: Client
const run = async (statements: string[]) => {
	for (const statement of statements) if (statement.trim()) await db.query(statement)
}

beforeAll(async () => {
	// PostgreSQL 18 "DROP DATABASE": FORCE ends the connections a crashed run left open.
	await admin('DROP DATABASE IF EXISTS hub_migration WITH (FORCE)')
	await admin('CREATE DATABASE hub_migration')
	db = new Client({ connectionString: MIGRATION_URL })
	await db.connect()
	await run(baseline!.sql)
	await db.query("INSERT INTO users (id, email, password) VALUES ($1, 'u@example.com', 'hash')", [
		USER,
	])
	await db.query("INSERT INTO user_groups (id, name) VALUES ($1, 'G')", [GROUP])
	await db.query(
		`INSERT INTO dify_apps (id, name, mode, description, tags, api_base, api_key, enable_answer_form, answer_form_feedback_text,
			enable_update_input_after_starts, opening_statement_display_mode, enable_annotation, icon_type, icon, icon_background, access_mode)
		VALUES ($1, 'Emoji chat', 'advanced-chat', 'desc', '["a","b"]', 'https://dify.example/v1', 'app-key-1', true, 'Thanks',
			true, 'always', true, 'emoji', '🍵', '#FFEAD5', 'restricted')`,
		[EMOJI_APP],
	)
	await db.query(
		`INSERT INTO dify_apps (id, name, mode, api_base, api_key, icon_type, icon, icon_image, icon_mime, access_mode)
		VALUES ($1, 'Image workflow', 'workflow', 'http://api:5001/v1', 'app-key-2', 'image', 'file', $2, 'image/png', 'everyone')`,
		[IMAGE_APP, PNG],
	)
	await db.query(
		"INSERT INTO dify_apps (id, name, mode, api_base, api_key) VALUES ($1, 'No mode', NULL, 'https://x.example/v1', 'app-key-3')",
		[NO_MODE_APP],
	)
	await db.query('INSERT INTO app_user_grants (app_id, user_id) VALUES ($1, $2)', [EMOJI_APP, USER])
	await db.query('INSERT INTO app_group_grants (app_id, group_id) VALUES ($1, $2)', [
		EMOJI_APP,
		GROUP,
	])
	await db.query('BEGIN')
	for (const migration of part1) await run(migration.sql)
	await db.query('COMMIT')
})

afterAll(async () => {
	await db?.end()
	await admin('DROP DATABASE IF EXISTS hub_migration WITH (FORCE)')
})

const appRow = async (id: string) =>
	(
		await db.query<{
			provider: string
			name: string
			description: string
			tags: unknown
			settings: unknown
			secrets: unknown
			icon_image: Buffer | null
			icon_mime: string | null
			access_mode: string
		}>(
			'SELECT provider, name, description, tags, settings, secrets, icon_image, icon_mime, access_mode FROM apps WHERE id = $1',
			[id],
		)
	).rows[0]

describe("Part 1's migration on Part 0's rows (spec §2.4)", () => {
	it('turns every Dify column into the settings, the key into the secrets, and the provider into dify', async () => {
		expect(await appRow(EMOJI_APP)).toMatchObject({
			provider: 'dify',
			name: 'Emoji chat',
			description: 'desc',
			tags: ['a', 'b'],
			settings: {
				apiBase: 'https://dify.example/v1',
				appType: 'advanced-chat',
				answerForm: { enabled: true, feedbackText: 'Thanks' },
				enableUpdateAfterConversationStarts: true,
				openingStatementDisplayMode: 'always',
			},
			secrets: { apiKey: 'app-key-1' },
			access_mode: 'restricted',
		})
	})
	it('gives a missing description and missing tags their defaults', async () => {
		expect(await appRow(IMAGE_APP)).toMatchObject({ description: '', tags: [] })
	})
	it('makes an emoji icon no icon and keeps an image with its bytes', async () => {
		expect(await appRow(EMOJI_APP)).toMatchObject({ icon_image: null, icon_mime: null })
		const image = await appRow(IMAGE_APP)
		expect(image?.icon_mime).toBe('image/png')
		expect(Buffer.compare(image!.icon_image!, PNG)).toBe(0)
	})
	// Review Focus 1: an app Part 0 stored without a known mode becomes an "Invalid settings" row for the admin to repair.
	it('keeps an app without a mode, with appType null', async () => {
		expect((await appRow(NO_MODE_APP))?.settings).toMatchObject({ appType: null })
	})
	it('keeps the grants', async () => {
		const users = await db.query('SELECT app_id FROM app_user_grants')
		const groups = await db.query('SELECT app_id FROM app_group_grants')
		expect(users.rows).toEqual([{ app_id: EMOJI_APP }])
		expect(groups.rows).toEqual([{ app_id: EMOJI_APP }])
	})
	it('leaves no Part 0 column and no dify_apps table', async () => {
		const { rows } = await db.query<{ column_name: string }>(
			"SELECT column_name FROM information_schema.columns WHERE table_name = 'apps' ORDER BY column_name",
		)
		expect(rows.map(row => row.column_name)).toEqual([
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
		])
		const tables = await db.query(
			"SELECT 1 FROM information_schema.tables WHERE table_name = 'dify_apps'",
		)
		expect(tables.rowCount).toBe(0)
	})
})
