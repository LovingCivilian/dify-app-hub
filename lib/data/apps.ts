import 'server-only'

import { and, desc, eq, exists, or, sql, type SQL } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/pg-core'

import { getDb, type Db } from '@/db'
import { appGroupGrants, appUserGrants, apps, userGroupMembers } from '@/db/schema'
import { fail, ok, type ActionResult } from '@/lib/action-result'
import type { AccessMode, AppAccessSettings } from '@/lib/app-access'
import { hasAdminRights } from '@/lib/auth/roles'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'
import { isProviderId, type ProviderId } from '@/lib/providers/ids'
import {
	PROVIDERS,
	type ProviderChatFields,
	type ProviderSecretsSet,
	type ProviderSummaryFields,
} from '@/lib/providers/registry'
import {
	checkDocuments,
	checkSettings,
	documentFieldErrors,
	mergeSecrets,
	PROVIDER_SCHEMAS,
	type ProviderSettings,
	type StoredDocuments,
	type StoredSettings,
} from '@/lib/providers/schemas'
import { APP_ICON_MAX_BYTES, type ImageErrorCode } from '@/lib/settings/image-rules'
import { ImageError, processImage } from '@/lib/settings/images'

/*
 * The apps Data Access Layer (charter §4.2; Part 1 spec §2.3). Every function takes the verified actor first: the entry
 * point (route, action, page) verifies the session once, and nothing here can be called without a SessionUser.
 * Admin-only reads and writes check the role themselves (assertAdmin); every user read applies `visibleTo`, so a `user`
 * reaches only the apps granted to it (ADR-0027). The documents are read and written through the provider registry
 * (lib/providers): parsed on every write and every read (decision 17), never half-typed, the secrets in no DTO (DV 10).
 * Saving never calls a provider (decision 18).
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** The stored tags, a jsonb array (PostgreSQL 18 "JSON Types"): its strings only, and [] for anything else. */
export const parseTags = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []

/** Whether an image is stored, computed by the database: no read selects the bytes (getAppIcon serves them). */
const hasIcon = sql<boolean>`${apps.iconImage} IS NOT NULL`.mapWith(Boolean)

/** A refused row is logged by its id and which document failed, never their values (OWASP Logging, "Data to exclude"). */
const logRefusal = (appId: string, code: string) =>
	console.error('Stored app documents refused:', { appId, code })

/** The settings alone, as a user's DTO reads need them, or null (spec §2.3); a refusal is logged. */
export const readSettings = (
	appId: string,
	provider: string,
	settings: unknown,
): StoredSettings | null => {
	const check = checkSettings(provider, settings)
	if (check.ok) return check.documents
	logRefusal(appId, check.code)
	return null
}

/**
 * A row's documents as its provider's schemas read them, or null (spec §2.3; decision 17: checked on every read). A row
 * that fails is never returned half-typed: users meet it as an unknown app, the admin as "Invalid settings".
 */
export const readDocuments = (
	appId: string,
	provider: string,
	settings: unknown,
	secrets: unknown,
): StoredDocuments | null => {
	const check = checkDocuments(provider, settings, secrets)
	if (check.ok) return check.documents
	logRefusal(appId, check.code)
	return null
}

/* ----- The user's DTOs (spec §2.3, §5) ----- */

/**
 * The columns a user's DTO reads: the neutral fields, the provider and the settings, never the secrets or the icon bytes
 * (Plan decision ab: a mapper cannot leak what is never read).
 */
const recordColumns = {
	id: apps.id,
	name: apps.name,
	description: apps.description,
	tags: apps.tags,
	isEnabled: apps.isEnabled,
	hasIcon,
	provider: apps.provider,
	settings: apps.settings,
}

type RecordRow = {
	id: string
	name: string
	description: string
	tags: unknown
	isEnabled: boolean
	hasIcon: boolean
	provider: string
	settings: unknown
}

/** An app as a user's DTOs see it: its neutral fields and its settings as its provider's schema reads them. */
export type AppRecord = {
	id: string
	name: string
	description: string
	tags: string[]
	enabled: boolean
	hasIcon: boolean
} & StoredSettings

const toRecord = (row: RecordRow): AppRecord | null => {
	const documents = readSettings(row.id, row.provider, row.settings)
	return (
		documents && {
			id: row.id,
			name: row.name,
			description: row.description,
			tags: parseTags(row.tags),
			enabled: row.isEnabled,
			hasIcon: row.hasIcon,
			...documents,
		}
	)
}

type ChatAppCommon = Pick<AppRecord, 'id' | 'name' | 'description' | 'enabled' | 'hasIcon'>

/** The chat's view (spec §2.3): a union keyed by provider; never the base URL or the secrets (file links go through the proxy). */
export type ChatAppDto = {
	[P in ProviderId]: ChatAppCommon & { provider: P } & ProviderChatFields<P>
}[ProviderId]

type SummaryCommon = Pick<AppRecord, 'id' | 'name' | 'description' | 'tags' | 'hasIcon'>

/** What a gallery card shows (spec §2.3, E10): the provider's own fields are its summary fields (for Dify, the type). */
export type AppSummary = {
	[P in ProviderId]: SummaryCommon & { provider: P } & ProviderSummaryFields<P>
}[ProviderId]

export const toChatAppDto = (record: AppRecord): ChatAppDto => ({
	id: record.id,
	provider: record.provider,
	name: record.name,
	description: record.description,
	enabled: record.enabled,
	hasIcon: record.hasIcon,
	...PROVIDERS[record.provider].chatFields(record.settings),
})

export const toAppSummary = (record: AppRecord): AppSummary => ({
	id: record.id,
	provider: record.provider,
	name: record.name,
	description: record.description,
	tags: record.tags,
	hasIcon: record.hasIcon,
	...PROVIDERS[record.provider].summaryFields(record.settings),
})

/* ----- The admin's DTO (spec §2.3, §4.5) ----- */

type AdminAppCommon = {
	id: string
	provider: ProviderId
	name: string
	description: string
	tags: string[]
	enabled: boolean
	hasIcon: boolean
	access: AppAccessSettings
	createdAt: string
	updatedAt: string
}

/**
 * The admin's view: every app with its access, its settings and which secrets are set, never their values (spec §2.3;
 * DV 10, OWASP ASVS 14.2.6). A row whose documents fail carries `invalid: true` and no settings: the table marks it and
 * the form opens on the provider's defaults so the admin can repair it.
 */
export type AdminAppDto =
	| {
			[P in ProviderId]: AdminAppCommon & {
				provider: P
				invalid: false
				settings: ProviderSettings<P>
				secretsSet: ProviderSecretsSet<P>
			}
	  }[ProviderId]
	| (AdminAppCommon & { invalid: true })

/** Every column the admin DTO reads: the secrets too (for `secretsSet`), never the icon bytes. */
const adminColumns = {
	id: apps.id,
	createdAt: apps.createdAt,
	updatedAt: apps.updatedAt,
	provider: apps.provider,
	name: apps.name,
	description: apps.description,
	tags: apps.tags,
	isEnabled: apps.isEnabled,
	accessMode: apps.accessMode,
	hasIcon,
	settings: apps.settings,
	secrets: apps.secrets,
}

type AdminRow = {
	id: string
	createdAt: Date
	updatedAt: Date
	provider: string
	name: string
	description: string
	tags: unknown
	isEnabled: boolean
	accessMode: AccessMode
	hasIcon: boolean
	settings: unknown
	secrets: unknown
}
type GroupGrant = { appId: string; groupId: string }
type UserGrant = { appId: string; userId: string }

/**
 * One app with its access; only the grants of this app count, whatever lists it is handed. Null for a provider the hub
 * does not know (DV 11: the CHECK allows none; such a row is logged and left out).
 */
export const toAdminAppDto = (
	row: AdminRow,
	groupGrants: readonly GroupGrant[],
	userGrants: readonly UserGrant[],
): AdminAppDto | null => {
	if (!isProviderId(row.provider)) {
		logRefusal(row.id, 'unknown_provider')
		return null
	}
	const common: AdminAppCommon = {
		id: row.id,
		provider: row.provider,
		name: row.name,
		description: row.description,
		tags: parseTags(row.tags),
		enabled: row.isEnabled,
		hasIcon: row.hasIcon,
		access: {
			mode: row.accessMode,
			groupIds: groupGrants.filter(grant => grant.appId === row.id).map(grant => grant.groupId),
			userIds: userGrants.filter(grant => grant.appId === row.id).map(grant => grant.userId),
		},
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	}
	const documents = readDocuments(row.id, row.provider, row.settings, row.secrets)
	if (!documents) return { ...common, invalid: true }
	return {
		...common,
		provider: documents.provider,
		invalid: false,
		settings: documents.settings,
		secretsSet: PROVIDERS[documents.provider].secretsSet(documents.secrets),
	}
}

/** The apps with their access, each grant list grouped once by app (MDN `Map.groupBy`); the apps' order stays. */
export const toAdminAppDtos = (
	rows: readonly AdminRow[],
	groupGrants: readonly GroupGrant[],
	userGrants: readonly UserGrant[],
): AdminAppDto[] => {
	const groupsOf = Map.groupBy(groupGrants, grant => grant.appId)
	const usersOf = Map.groupBy(userGrants, grant => grant.appId)
	return rows.flatMap(row => {
		const dto = toAdminAppDto(row, groupsOf.get(row.id) ?? [], usersOf.get(row.id) ?? [])
		return dto ? [dto] : []
	})
}

/* ----- Access and grants (ADR-0027) ----- */

/** The grant rows an access setting stores (B3 spec §4.4): none while open to everyone (deviation 4), each id once. */
export const grantRowsFor = (appId: string, access: AppAccessSettings) =>
	access.mode === 'everyone'
		? { groups: [], users: [] }
		: {
				groups: [...new Set(access.groupIds)].map(groupId => ({ appId, groupId })),
				users: [...new Set(access.userIds)].map(userId => ({ appId, userId })),
			}

/** Replaces the app's grants inside the caller's transaction; a deleted group or account fails it (23503). */
const writeGrants = async (
	tx: Pick<Tx, 'delete' | 'insert'>,
	appId: string,
	access: AppAccessSettings,
) => {
	const rows = grantRowsFor(appId, access)
	await tx.delete(appGroupGrants).where(eq(appGroupGrants.appId, appId))
	await tx.delete(appUserGrants).where(eq(appUserGrants.appId, appId))
	if (rows.groups.length) await tx.insert(appGroupGrants).values(rows.groups)
	if (rows.users.length) await tx.insert(appUserGrants).values(rows.users)
}

/**
 * A locking read of one app by its primary key (ADR-0024 decision d; PostgreSQL 18 "Explicit Locking", 13.3.2: FOR
 * UPDATE "prevents them from being locked, modified or deleted by other transactions until the current transaction
 * ends"), with the provider and the stored secrets the update needs: the update reads them under the lock, so an app
 * deleted after the form loaded answers not_found and writes nothing (ruling M11 of B3a).
 */
export const lockApp = (tx: Pick<Tx, 'select'>, id: string) =>
	tx
		.select({ id: apps.id, provider: apps.provider, secrets: apps.secrets })
		.from(apps)
		.where(eq(apps.id, id))
		.limit(1)
		.for('update')

/** This app, of this provider (spec §2.3: the provider never changes after insert, so a write names the stored one). */
export const appOfProvider = (id: string, provider: ProviderId) =>
	and(eq(apps.id, id), eq(apps.provider, provider))

/** Builds the access rule's subqueries without a database instance (Drizzle docs, standalone query builder). */
const qb = new QueryBuilder()

/**
 * Which apps an actor may use (B3 spec §4.1, ADR-0027): every app for an account with admin rights (no condition),
 * otherwise an app open to everyone, granted to the account, or granted to a group it belongs to, whatever the
 * membership's source. One rule for the list and every single-app read (spec §4.2; OWASP Authorization "Validate the
 * Permissions on Every Request"; Next "A Data Access Layer should … Perform authorization checks"). Built with
 * Drizzle's `or`/`exists` on correlated subqueries; `and()` skips the undefined an admin gets.
 */
export const visibleTo = (actor: Pick<SessionUser, 'id' | 'role'>): SQL | undefined =>
	hasAdminRights(actor)
		? undefined
		: or(
				eq(apps.accessMode, 'everyone'),
				exists(
					qb
						.select({ one: sql`1` })
						.from(appUserGrants)
						.where(and(eq(appUserGrants.appId, apps.id), eq(appUserGrants.userId, actor.id))),
				),
				exists(
					qb
						.select({ one: sql`1` })
						.from(appGroupGrants)
						.innerJoin(userGroupMembers, eq(userGroupMembers.groupId, appGroupGrants.groupId))
						.where(and(eq(appGroupGrants.appId, apps.id), eq(userGroupMembers.userId, actor.id))),
				),
			)

/* ----- Reads ----- */

/**
 * The gallery (spec §2.3, §5): the enabled apps the actor may use, newest first, as cards. An app whose settings fail is
 * left out (logged); the access rule is visibleTo, as for every read (ADR-0027).
 */
export async function listApps(actor: SessionUser): Promise<AppSummary[]> {
	const rows = await getDb()
		.select(recordColumns)
		.from(apps)
		.where(and(eq(apps.isEnabled, true), visibleTo(actor)))
		.orderBy(desc(apps.createdAt))
	return rows.flatMap(row => {
		const record = toRecord(row)
		return record ? [toAppSummary(record)] : []
	})
}

/** Every app with its access, for /app-management (B3a deviation 1). */
export async function listAdminApps(actor: SessionUser): Promise<AdminAppDto[]> {
	assertAdmin(actor)
	const db = getDb()
	const [rows, groupGrants, userGrants] = await Promise.all([
		db.select(adminColumns).from(apps).orderBy(desc(apps.createdAt)),
		db
			.select({ appId: appGroupGrants.appId, groupId: appGroupGrants.groupId })
			.from(appGroupGrants),
		db.select({ appId: appUserGrants.appId, userId: appUserGrants.userId }).from(appUserGrants),
	])
	return toAdminAppDtos(rows, groupGrants, userGrants)
}

/**
 * Null for a missing app, one the actor may not use, and one whose settings fail alike (B3 spec §4.2: no difference to
 * probe; Part 1 spec §2.3: users meet a broken row as an unknown app).
 */
export async function getChatApp(actor: SessionUser, id: string): Promise<ChatAppDto | null> {
	const [row] = await getDb()
		.select(recordColumns)
		.from(apps)
		.where(and(eq(apps.id, id), visibleTo(actor)))
		.limit(1)
	const record = row ? toRecord(row) : null
	return record ? toChatAppDto(record) : null
}

/**
 * What a provider route needs (spec §2.3): whether the app may be used, and its documents as its provider's schemas read
 * them. Built only for the server-only route guard (lib/providers/route.ts); never a DTO.
 */
export type AppAccess = { id: string; enabled: boolean } & StoredDocuments

/** For the provider routes: null when missing, not the actor's to use, or refused by its schemas. */
export async function getAppAccess(actor: SessionUser, id: string): Promise<AppAccess | null> {
	const [row] = await getDb()
		.select({
			id: apps.id,
			isEnabled: apps.isEnabled,
			provider: apps.provider,
			settings: apps.settings,
			secrets: apps.secrets,
		})
		.from(apps)
		.where(and(eq(apps.id, id), visibleTo(actor)))
		.limit(1)
	if (!row) return null
	const documents = readDocuments(row.id, row.provider, row.settings, row.secrets)
	return documents && { id: row.id, enabled: row.isEnabled, ...documents }
}

export async function getAppIcon(
	actor: SessionUser,
	id: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
	const [row] = await getDb()
		.select({ iconImage: apps.iconImage, iconMime: apps.iconMime })
		.from(apps)
		.where(and(eq(apps.id, id), visibleTo(actor)))
		.limit(1)
	return row?.iconImage && row.iconMime ? { bytes: row.iconImage, mime: row.iconMime } : null
}

/**
 * The stored secrets of this app of this provider, for a connection test that leaves a secret blank (spec §4.2): read on
 * the server and never answered to the browser. Admin only; null when there is no such app.
 */
export async function getStoredSecrets(
	actor: SessionUser,
	id: string,
	provider: ProviderId,
): Promise<{ secrets: unknown } | null> {
	assertAdmin(actor)
	const [row] = await getDb()
		.select({ secrets: apps.secrets })
		.from(apps)
		.where(appOfProvider(id, provider))
		.limit(1)
	return row ? { secrets: row.secrets } : null
}

/* ----- Writes (spec §2.3, §4.3, §4.4) ----- */

/** An icon change (spec §4.1, §4.4): keep the stored image, remove it, or replace it with an upload. */
export type IconChange =
	| { intent: 'keep' }
	| { intent: 'remove' }
	| { intent: 'replace'; file: File }

/** The admin-owned fields every provider shares (spec §2.1; decision 5). */
export interface AppCommonInput {
	name: string
	description: string
	tags: string[]
	enabled: boolean
}

export interface CreateAppInput {
	provider: ProviderId
	common: AppCommonInput
	access: AppAccessSettings
	settings: unknown
	secrets: unknown
	icon: IconChange
}

/** An edit takes no provider: the stored one stays (spec §2.3). A secret left undefined keeps its stored value. */
export interface UpdateAppInput {
	common: AppCommonInput
	access: AppAccessSettings
	settings: unknown
	secrets: Record<string, string | undefined>
	icon: IconChange
}

type IconColumns = { iconImage: Buffer | null; iconMime: string | null }

/**
 * The icon columns a change writes (spec §4.4), or why the image was refused. A replacement goes through ADR-0030's
 * pipeline before any transaction, as saveBranding does (PostgreSQL 18 "Explicit Locking": no long-held transactions);
 * an upload over the cap is refused unread by its size (MDN `Blob.size`), before `arrayBuffer()` copies it.
 */
const iconColumnsFor = async (
	icon: IconChange,
): Promise<{ ok: true; columns?: IconColumns } | { ok: false; code: ImageErrorCode }> => {
	if (icon.intent === 'keep') return { ok: true }
	if (icon.intent === 'remove') return { ok: true, columns: { iconImage: null, iconMime: null } }
	try {
		if (icon.file.size > APP_ICON_MAX_BYTES) throw new ImageError('too_large')
		const image = await processImage('appIcon', Buffer.from(await icon.file.arrayBuffer()))
		return { ok: true, columns: { iconImage: image.bytes, iconMime: 'image/png' } }
	} catch (error) {
		if (!(error instanceof ImageError)) throw error
		return { ok: false, code: error.code }
	}
}

const commonColumns = (common: AppCommonInput, access: AppAccessSettings) => ({
	name: common.name,
	description: common.description,
	tags: common.tags,
	isEnabled: common.enabled,
	accessMode: access.mode,
})

/**
 * Creates the app: both documents parsed again by the provider's schemas (the action parsed them too; DV 8b), the icon
 * through the pipeline first, then the row and its grants in one transaction (a deleted group or account rejects the
 * grant insert with 23503 and no app is left behind). Saving never calls the provider (decision 18).
 */
export async function createApp(
	actor: SessionUser,
	input: CreateAppInput,
): Promise<ActionResult<{ id: string }>> {
	assertAdmin(actor)
	const schemas = PROVIDER_SCHEMAS[input.provider]
	const settings = schemas.settingsSchema.safeParse(input.settings)
	if (!settings.success)
		return fail('invalid_input', documentFieldErrors('settings', settings.error))
	const secrets = schemas.secretsSchema.safeParse(input.secrets)
	if (!secrets.success) return fail('invalid_input', documentFieldErrors('secrets', secrets.error))
	const icon = await iconColumnsFor(input.icon)
	if (!icon.ok) return fail('invalid_image', { icon: [icon.code] })
	const id = crypto.randomUUID()
	await getDb().transaction(async tx => {
		await tx.insert(apps).values({
			id,
			provider: input.provider,
			...commonColumns(input.common, input.access),
			settings: settings.data,
			secrets: secrets.data,
			...icon.columns,
		})
		await writeGrants(tx, id, input.access)
	})
	return ok({ id })
}

/**
 * Updates the app under a lock on its row: the provider is the stored one (the update's WHERE names it, spec §2.3), the
 * settings are parsed by its schema, a blank secret keeps the stored value (the stored document with the given fields
 * laid over it, then parsed; spec §2.3, DV 10), the icon goes through the pipeline before the transaction, and the
 * grants are replaced with the row. not_found when the app is gone. Saving never calls the provider (decision 18).
 */
export async function updateApp(
	actor: SessionUser,
	id: string,
	input: UpdateAppInput,
): Promise<ActionResult> {
	assertAdmin(actor)
	const icon = await iconColumnsFor(input.icon)
	if (!icon.ok) return fail('invalid_image', { icon: [icon.code] })
	return getDb().transaction(async (tx): Promise<ActionResult> => {
		const [locked] = await lockApp(tx, id)
		if (!locked || !isProviderId(locked.provider)) return fail('not_found')
		const schemas = PROVIDER_SCHEMAS[locked.provider]
		const settings = schemas.settingsSchema.safeParse(input.settings)
		if (!settings.success)
			return fail('invalid_input', documentFieldErrors('settings', settings.error))
		const secrets = schemas.secretsSchema.safeParse(mergeSecrets(locked.secrets, input.secrets))
		if (!secrets.success)
			return fail('invalid_input', documentFieldErrors('secrets', secrets.error))
		await tx
			.update(apps)
			.set({
				...commonColumns(input.common, input.access),
				settings: settings.data,
				secrets: secrets.data,
				...icon.columns,
			})
			.where(appOfProvider(id, locked.provider))
		await writeGrants(tx, id, input.access)
		return ok(undefined)
	})
}

export async function deleteApp(actor: SessionUser, id: string): Promise<boolean> {
	assertAdmin(actor)
	// node-postgres "Result": `rowCount` is the rows the command processed, null for a command that reports none.
	const result = await getDb().delete(apps).where(eq(apps.id, id))
	return (result.rowCount ?? 0) > 0
}
