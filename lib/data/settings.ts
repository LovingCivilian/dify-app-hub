import 'server-only'

import { and, eq } from 'drizzle-orm'

import { getDb, type Db } from '@/db'
import { instanceSettingFiles, instanceSettings, users } from '@/db/schema'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'

import { isDeadlock } from './db-errors'

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** The areas with a row (settings spec §3.2); SMTP and LDAP join in their own PRs. */
export type SettingsArea = 'branding'

/** What the public read answers: the document only, never who saved it. */
export interface InstanceSetting {
	data: unknown
}

/** Who saved the area last and when, for the admin page (spec §3.2). */
export interface InstanceSettingChange {
	updatedAt: Date
	/** The saving account's email while that account exists (left join; no foreign key, spec §3.2). */
	updatedByEmail: string | null
}

export interface InstanceSettingFile {
	bytes: Buffer
	mime: string
}

/** A file to store under the area, or `null` to delete it; a name left out keeps its file. */
export type InstanceSettingFileChanges = Partial<Record<string, InstanceSettingFile | null>>

/** Transaction attempts in all when PostgreSQL ends a save as a deadlock's victim (40P01). */
const DEADLOCK_ATTEMPTS = 3

export const selectInstanceSetting = (db: Pick<Db, 'select'>, area: SettingsArea) =>
	db
		.select({ data: instanceSettings.data })
		.from(instanceSettings)
		.where(eq(instanceSettings.area, area))
		.limit(1)

export const selectInstanceSettingChange = (db: Pick<Db, 'select'>, area: SettingsArea) =>
	db
		.select({ updatedAt: instanceSettings.updatedAt, updatedByEmail: users.email })
		.from(instanceSettings)
		.leftJoin(users, eq(users.id, instanceSettings.updatedBy))
		.where(eq(instanceSettings.area, area))
		.limit(1)

export const selectInstanceSettingFile = (
	db: Pick<Db, 'select'>,
	area: SettingsArea,
	name: string,
) =>
	db
		.select({ bytes: instanceSettingFiles.bytes, mime: instanceSettingFiles.mime })
		.from(instanceSettingFiles)
		.where(and(eq(instanceSettingFiles.area, area), eq(instanceSettingFiles.name, name)))
		.limit(1)

/**
 * The locking read of the area's document (PostgreSQL 18 "SELECT", The Locking Clause), as the house `lockGroup` does.
 * Once the row exists, two saves of the area queue here, so the second builds its document from the first's. Before the
 * first save there is no row to lock (FOR UPDATE locks "the rows retrieved by the SELECT statement", "Explicit
 * Locking", 13.3.2), so two first saves both build from no document; writeInstanceSetting's upsert keeps the later one.
 */
export const lockInstanceSetting = (tx: Pick<Tx, 'select'>, area: SettingsArea) =>
	tx
		.select({ data: instanceSettings.data })
		.from(instanceSettings)
		.where(eq(instanceSettings.area, area))
		.limit(1)
		.for('update')

export const deleteInstanceSettingFile = (
	tx: Pick<Tx, 'delete'>,
	area: SettingsArea,
	name: string,
) =>
	tx
		.delete(instanceSettingFiles)
		.where(and(eq(instanceSettingFiles.area, area), eq(instanceSettingFiles.name, name)))

/**
 * The area's document, or null before its first save. It takes no actor and answers the document only: the brand is
 * public by design, since the login page shows it (spec §3.3). Later areas' reads (SMTP, LDAP) are gated functions in
 * this DAL (ADR-0024), not callers' duty.
 */
export const readInstanceSetting = async (area: SettingsArea): Promise<InstanceSetting | null> => {
	const [row] = await selectInstanceSetting(getDb(), area)
	return row ?? null
}

/**
 * Who saved the area last and when, for the admin page. Gated in the DAL (ADR-0024; Next's data-security guide:
 * authorization checks and minimal DTOs): the public read above never carries an admin's id or email.
 */
export const readInstanceSettingChange = async (
	actor: SessionUser,
	area: SettingsArea,
): Promise<InstanceSettingChange | null> => {
	assertAdmin(actor)
	const [row] = await selectInstanceSettingChange(getDb(), area)
	return row ?? null
}

export const readInstanceSettingFile = async (
	area: SettingsArea,
	name: string,
): Promise<InstanceSettingFile | null> => {
	const [row] = await selectInstanceSettingFile(getDb(), area, name)
	return row ?? null
}

/**
 * Saves the area's document and its file changes in one transaction, so a document never names a missing file (spec
 * §4.3). The row is read under a lock inside the transaction and `build` makes the document from it (null before the
 * first save); `build` answering `undefined` writes nothing and the save answers `false` (a refused change). Two first
 * saves both find no row; the second's upsert waits for the first to commit and then updates the row (PostgreSQL 18
 * "INSERT": ON CONFLICT DO UPDATE "guarantees an atomic INSERT or UPDATE outcome"), so the later save wins. A deadlock
 * can still end a save (deadlocks "can occur even if explicit locking is not used", "Explicit Locking", 13.3.4), so the
 * transaction runs again, up to DEADLOCK_ATTEMPTS in all ("It may also be advisable to retry deadlock failures",
 * "Serialization Failure Handling", 13.5); `build` must therefore be repeatable. The role is checked again here
 * (ADR-0024: the DAL's own gate).
 */
export const writeInstanceSetting = async (
	actor: SessionUser,
	area: SettingsArea,
	build: (current: unknown | null) => unknown | undefined,
	files: InstanceSettingFileChanges,
): Promise<boolean> => {
	assertAdmin(actor)
	for (let attempt = 1; ; attempt += 1) {
		try {
			return await getDb().transaction(async tx => {
				const [row] = await lockInstanceSetting(tx, area)
				const data = build(row?.data ?? null)
				if (data === undefined) return false
				const now = new Date()
				// An upsert updates the row in place (Drizzle "Upsert", `onConflictDoUpdate`; PostgreSQL 18 "INSERT": ON
				// CONFLICT DO UPDATE "updates the existing row that conflicts with the row proposed for insertion"), where a
				// delete and insert would cascade away the file rows that belong to it. pg-core has no onDuplicateKeyUpdate.
				await tx
					.insert(instanceSettings)
					.values({ area, data, updatedAt: now, updatedBy: actor.id })
					.onConflictDoUpdate({
						target: instanceSettings.area,
						set: { data, updatedAt: now, updatedBy: actor.id },
					})
				for (const [name, file] of Object.entries(files)) {
					if (file === undefined) continue
					if (file === null) {
						await deleteInstanceSettingFile(tx, area, name)
						continue
					}
					await tx
						.insert(instanceSettingFiles)
						.values({ area, name, bytes: file.bytes, mime: file.mime, updatedAt: now })
						.onConflictDoUpdate({
							target: [instanceSettingFiles.area, instanceSettingFiles.name],
							set: { bytes: file.bytes, mime: file.mime, updatedAt: now },
						})
				}
				return true
			})
		} catch (error) {
			if (!isDeadlock(error) || attempt === DEADLOCK_ATTEMPTS) throw error
		}
	}
}
