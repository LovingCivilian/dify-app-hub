import 'server-only'

import { and, eq } from 'drizzle-orm'

import { getDb } from '@/db'
import { instanceSettingFiles, instanceSettings, users } from '@/db/schema'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'

/** The areas with a row (settings spec §3.2); SMTP and LDAP join in their own PRs. */
export type SettingsArea = 'branding'

export interface InstanceSettingRow {
	data: unknown
	updatedAt: Date
	updatedBy: string | null
	/** The saving account's email while that account exists (left join; no foreign key, spec §3.2). */
	updatedByEmail: string | null
}

export interface InstanceSettingFile {
	bytes: Buffer
	mime: string
}

/** A file to store under the area, or `null` to delete it; a name left out keeps its file. */
export type InstanceSettingFileChanges = Partial<Record<string, InstanceSettingFile | null>>

/**
 * The area's row, or null before its first save. It takes no actor: the brand is public by design, since the login page
 * shows it (spec §3.3); SMTP's and LDAP's readers add their own gate.
 */
export const readInstanceSetting = async (
	area: SettingsArea,
): Promise<InstanceSettingRow | null> => {
	const [row] = await getDb()
		.select({
			data: instanceSettings.data,
			updatedAt: instanceSettings.updatedAt,
			updatedBy: instanceSettings.updatedBy,
			updatedByEmail: users.email,
		})
		.from(instanceSettings)
		.leftJoin(users, eq(users.id, instanceSettings.updatedBy))
		.where(eq(instanceSettings.area, area))
		.limit(1)
	return row ?? null
}

export const readInstanceSettingFile = async (
	area: SettingsArea,
	name: string,
): Promise<InstanceSettingFile | null> => {
	const [row] = await getDb()
		.select({ bytes: instanceSettingFiles.bytes, mime: instanceSettingFiles.mime })
		.from(instanceSettingFiles)
		.where(and(eq(instanceSettingFiles.area, area), eq(instanceSettingFiles.name, name)))
		.limit(1)
	return row ?? null
}

/**
 * Saves the area's document and its file changes in one transaction, so a document never names a missing file (spec §4.3).
 * The role is checked again here (ADR-0024: the DAL's own gate).
 */
export const writeInstanceSetting = async (
	actor: SessionUser,
	area: SettingsArea,
	data: unknown,
	files: InstanceSettingFileChanges,
): Promise<void> => {
	assertAdmin(actor)
	const now = new Date()
	await getDb().transaction(async tx => {
		await tx
			.insert(instanceSettings)
			.values({ area, data, updatedAt: now, updatedBy: actor.id })
			.onDuplicateKeyUpdate({ set: { data, updatedAt: now, updatedBy: actor.id } })
		for (const [name, file] of Object.entries(files)) {
			if (file === undefined) continue
			if (file === null) {
				await tx
					.delete(instanceSettingFiles)
					.where(and(eq(instanceSettingFiles.area, area), eq(instanceSettingFiles.name, name)))
				continue
			}
			await tx
				.insert(instanceSettingFiles)
				.values({ area, name, bytes: file.bytes, mime: file.mime, updatedAt: now })
				.onDuplicateKeyUpdate({ set: { bytes: file.bytes, mime: file.mime, updatedAt: now } })
		}
	})
}
