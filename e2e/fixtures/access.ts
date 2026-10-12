import { randomUUID } from 'node:crypto'

import { withDb } from './db'
import { stubApiBase } from './env'

/** A 1×1 PNG, so the icon route has bytes to serve. */
const PIXEL_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
)

/**
 * An app row of the spec's own on the stub's chat app (prefix ''), with a stored image icon; its name must carry the
 * project name, and the spec deletes it in `afterEach` (its grants go with it, ON DELETE CASCADE).
 */
export const seedApp = async ({
	name,
	accessMode,
}: {
	name: string
	accessMode: 'everyone' | 'restricted'
}): Promise<string> => {
	const id = randomUUID()
	await withDb(db =>
		db.query(
			"INSERT INTO dify_apps (id, name, mode, description, api_base, api_key, access_mode, icon_type, icon, icon_image, icon_mime) VALUES ($1, $2, 'chat', 'Seeded for an access spec', $3, 'app-e2e', $4, 'image', 'file-1', $5, 'image/png')",
			[id, name, stubApiBase, accessMode, PIXEL_PNG],
		),
	)
	return id
}

export const deleteApp = (id: string) =>
	withDb(db => db.query('DELETE FROM dify_apps WHERE id = $1', [id]))

/** The ids of every app open to everyone, so a case that closes them can reopen exactly these. */
export const appsOpenToEveryone = () =>
	withDb(async db => {
		const { rows } = await db.query<{ id: string }>(
			"SELECT id FROM dify_apps WHERE access_mode = 'everyone'",
		)
		return rows.map(row => row.id)
	})

export const setAccessMode = (ids: string[], accessMode: 'everyone' | 'restricted') =>
	withDb(async db => {
		for (const id of ids)
			await db.query('UPDATE dify_apps SET access_mode = $1 WHERE id = $2', [accessMode, id])
	})

/** Deletes the apps whose name matches a pattern (a run killed before its clean-up), without case as MySQL compared. */
export const deleteAppsLike = (pattern: string) =>
	withDb(db => db.query('DELETE FROM dify_apps WHERE name ILIKE $1', [pattern]))

/** A group with manual members; its name must carry the project name. */
export const seedGroup = async ({
	name,
	memberIds = [],
}: {
	name: string
	memberIds?: string[]
}): Promise<string> => {
	const id = randomUUID()
	await withDb(async db => {
		// The leftover is found as the unique index compares (user_groups_name_key on lower(name)).
		await db.query('DELETE FROM user_groups WHERE lower(name) = lower($1)', [name])
		await db.query('INSERT INTO user_groups (id, name) VALUES ($1, $2)', [id, name])
		for (const userId of memberIds)
			await db.query(
				"INSERT INTO user_group_members (group_id, user_id, source) VALUES ($1, $2, 'manual')",
				[id, userId],
			)
	})
	return id
}

export const deleteGroupsLike = (pattern: string) =>
	withDb(db => db.query('DELETE FROM user_groups WHERE name ILIKE $1', [pattern]))

export const grantAppToUser = (appId: string, userId: string) =>
	withDb(db =>
		db.query('INSERT INTO app_user_grants (app_id, user_id) VALUES ($1, $2)', [appId, userId]),
	)

export const grantAppToGroup = (appId: string, groupId: string) =>
	withDb(db =>
		db.query('INSERT INTO app_group_grants (app_id, group_id) VALUES ($1, $2)', [appId, groupId]),
	)
