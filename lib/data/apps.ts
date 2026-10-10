import 'server-only'

import { and, desc, eq, exists, or, sql, type SQL } from 'drizzle-orm'
import { QueryBuilder } from 'drizzle-orm/mysql-core'

import { getDb, type Db } from '@/db'
import { appGroupGrants, appUserGrants, difyApps, userGroupMembers } from '@/db/schema'
import type { AccessMode, AppAccessSettings } from '@/lib/app-access'
import { hasAdminRights } from '@/lib/auth/roles'
import { assertAdmin, type SessionUser } from '@/lib/auth/session'
import { difyClient, type DifyCredentials } from '@/lib/dify/client'
import { DifyError } from '@/lib/dify/errors'
import { isAppMode, type AppInfo, type AppMode, type SiteSettings } from '@/lib/dify/types'

/*
 * The apps Data Access Layer (charter §4.2). Every function takes the verified actor first: the entry point
 * (route, action, page) verifies the session once, and nothing here can be called without a SessionUser.
 * Admin-only writes check the role themselves (assertAdmin); every read applies `visibleTo`, so a `user` reaches only
 * the apps granted to it (ADR-0027).
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type AppRow = typeof difyApps.$inferSelect
type IconColumns = Pick<AppRow, 'iconType' | 'icon' | 'iconBackground' | 'iconImage' | 'iconMime'>

/**
 * Every column the DTOs read, never the key or the icon bytes (charter §4.2: explicit columns; the image itself is
 * served through getAppIcon). Whether an image is stored is computed by MySQL.
 */
const dtoColumns = {
	id: difyApps.id,
	createdAt: difyApps.createdAt,
	updatedAt: difyApps.updatedAt,
	name: difyApps.name,
	mode: difyApps.mode,
	description: difyApps.description,
	tags: difyApps.tags,
	isEnabled: difyApps.isEnabled,
	apiBase: difyApps.apiBase,
	enableAnswerForm: difyApps.enableAnswerForm,
	answerFormFeedbackText: difyApps.answerFormFeedbackText,
	enableUpdateInputAfterStarts: difyApps.enableUpdateInputAfterStarts,
	openingStatementDisplayMode: difyApps.openingStatementDisplayMode,
	enableAnnotation: difyApps.enableAnnotation,
	iconType: difyApps.iconType,
	icon: difyApps.icon,
	iconBackground: difyApps.iconBackground,
	hasIconImage: sql<boolean>`${difyApps.iconImage} IS NOT NULL`.mapWith(Boolean),
}

/** A row as the DTOs read it (dtoColumns). */
type DtoRow = Omit<AppRow, 'apiKey' | 'iconImage' | 'iconMime' | 'accessMode'> & {
	hasIconImage: boolean
}

export type OpeningStatementDisplayMode = 'default' | 'always'

export interface AppSettings {
	answerForm: { enabled: boolean; feedbackText: string }
	enableUpdateAfterConversationStarts: boolean
	openingStatementDisplayMode: OpeningStatementDisplayMode
	annotationEnabled: boolean
}

/** What the browser needs to draw the icon (charter §4.1): the image itself comes from GET /api/apps/[appId]/icon. */
export type AppIcon =
	| { kind: 'emoji'; emoji: string; background: string | null }
	| { kind: 'image' }
	| null

/** The admin's view: everything but the key (the edit form never shows the stored key). */
export interface AppDto {
	id: string
	name: string
	mode: AppMode | null
	description: string
	tags: string[]
	enabled: boolean
	icon: AppIcon
	settings: AppSettings
	apiBase: string
	createdAt: string
	updatedAt: string
}

/** The chat's view: no key, no base (file links go through the proxy). */
export interface ChatAppDto {
	id: string
	name: string
	mode: AppMode | null
	description: string
	enabled: boolean
	icon: AppIcon
	settings: AppSettings
}

/** What a Dify route needs: whether the app may be used, and how to reach Dify. */
export interface AppAccess {
	id: string
	enabled: boolean
	/** The app's annotation switch: a user-role account may create annotations only where it is on (charter §4.1). */
	annotationEnabled: boolean
	credentials: DifyCredentials
}

/** What the admin form sends (validated by the action's schema). `apiKey` is required on create, optional on update. */
export interface AppInput {
	apiBase: string
	apiKey?: string
	mode: AppMode
	enabled: boolean
	settings: AppSettings
	access: AppAccessSettings
}

/** The admin's view (plan deviation 1): the app DTO and who may use it; the gallery never receives the grants. */
export interface AdminAppDto extends AppDto {
	access: AppAccessSettings
}

export interface SyncResult {
	id: string
	/** The Dify info was stored but the icon image could not be (kept the previous one). */
	partial: boolean
}

export const ICON_MAX_BYTES = 1024 * 1024

export const parseTags = (text: string | null): string[] => {
	try {
		const value: unknown = JSON.parse(text ?? '[]')
		return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : []
	} catch {
		return []
	}
}

export const iconOf = (
	row: Pick<DtoRow, 'iconType' | 'icon' | 'iconBackground' | 'hasIconImage'>,
): AppIcon => {
	if (row.iconType === 'emoji' && row.icon) {
		return { kind: 'emoji', emoji: row.icon, background: row.iconBackground ?? null }
	}
	if (row.iconType === 'image' && row.hasIconImage) return { kind: 'image' }
	return null
}

export const settingsOf = (
	row: Pick<
		AppRow,
		| 'enableAnswerForm'
		| 'answerFormFeedbackText'
		| 'enableUpdateInputAfterStarts'
		| 'openingStatementDisplayMode'
		| 'enableAnnotation'
	>,
): AppSettings => ({
	answerForm: { enabled: row.enableAnswerForm, feedbackText: row.answerFormFeedbackText ?? '' },
	enableUpdateAfterConversationStarts: row.enableUpdateInputAfterStarts,
	openingStatementDisplayMode: row.openingStatementDisplayMode === 'always' ? 'always' : 'default',
	annotationEnabled: row.enableAnnotation,
})

const modeOf = (mode: string | null): AppMode | null => (isAppMode(mode) ? mode : null)

export const toAppDto = (row: DtoRow): AppDto => ({
	id: row.id,
	name: row.name,
	mode: modeOf(row.mode),
	description: row.description ?? '',
	tags: parseTags(row.tags),
	enabled: row.isEnabled,
	icon: iconOf(row),
	settings: settingsOf(row),
	apiBase: row.apiBase,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
})

export const toChatAppDto = (row: DtoRow): ChatAppDto => ({
	id: row.id,
	name: row.name,
	mode: modeOf(row.mode),
	description: row.description ?? '',
	enabled: row.isEnabled,
	icon: iconOf(row),
	settings: settingsOf(row),
})

type AdminDtoRow = DtoRow & { accessMode: AccessMode }
type GroupGrant = { appId: string; groupId: string }
type UserGrant = { appId: string; userId: string }

/** One app with its access; only the grants of this app count, whatever lists it is handed. */
export const toAdminAppDto = (
	row: AdminDtoRow,
	groupGrants: readonly GroupGrant[],
	userGrants: readonly UserGrant[],
): AdminAppDto => ({
	...toAppDto(row),
	access: {
		mode: row.accessMode,
		groupIds: groupGrants.filter(grant => grant.appId === row.id).map(grant => grant.groupId),
		userIds: userGrants.filter(grant => grant.appId === row.id).map(grant => grant.userId),
	},
})

/** The apps with their access, each grant list grouped once by app (MDN `Map.groupBy`); the apps' order stays. */
export const toAdminAppDtos = (
	rows: readonly AdminDtoRow[],
	groupGrants: readonly GroupGrant[],
	userGrants: readonly UserGrant[],
): AdminAppDto[] => {
	const groupsOf = Map.groupBy(groupGrants, grant => grant.appId)
	const usersOf = Map.groupBy(userGrants, grant => grant.appId)
	return rows.map(row => toAdminAppDto(row, groupsOf.get(row.id) ?? [], usersOf.get(row.id) ?? []))
}

/** The grant rows an access setting stores (spec §4.4): none while open to everyone (deviation 4), each id once. */
export const grantRowsFor = (appId: string, access: AppAccessSettings) =>
	access.mode === 'everyone'
		? { groups: [], users: [] }
		: {
				groups: [...new Set(access.groupIds)].map(groupId => ({ appId, groupId })),
				users: [...new Set(access.userIds)].map(userId => ({ appId, userId })),
			}

/** Replaces the app's grants inside the caller's transaction; a deleted group or account fails it (1452). */
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
 * A locking read of one app by its primary key (ADR-0024 decision d; MySQL 8.4 "Locking Reads": before writing
 * related rows in the same transaction, "the regular SELECT statement does not give enough protection"). The update
 * takes it before it writes the grants, so an app deleted after the access read answers not_found and writes nothing,
 * instead of the grant insert's 1452 reading as a stale pick (ruling M11); a delete that comes later waits for it.
 */
export const lockApp = (tx: Pick<Tx, 'select'>, id: string) =>
	tx.select({ id: difyApps.id }).from(difyApps).where(eq(difyApps.id, id)).limit(1).for('update')

/**
 * The bytes of an image answer within the cap, else null: a non-image type, a declared or actual size over
 * the cap, or a body that cannot be read (Review Focus 4).
 */
export const readIconBytes = async (
	response: Response,
	cap = ICON_MAX_BYTES,
): Promise<{ bytes: Buffer; mime: string } | null> => {
	const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim()
	if (!mime.startsWith('image/')) return null
	const declared = Number(response.headers.get('content-length'))
	if (Number.isFinite(declared) && declared > cap) return null
	try {
		const bytes = Buffer.from(await response.arrayBuffer())
		return bytes.length > cap ? null : { bytes, mime }
	} catch {
		return null
	}
}

/**
 * The icon columns for a site answer. An image icon's bytes are fetched through Dify's signed url by the given
 * function; when that fails the columns are left undefined (the row keeps its previous icon) and `partial` says so.
 */
export const iconColumnsFrom = async (
	site: SiteSettings | null,
	fetchImage: (url: string) => Promise<{ bytes: Buffer; mime: string } | null>,
): Promise<{ columns: IconColumns | undefined; partial: boolean }> => {
	const none: IconColumns = {
		iconType: null,
		icon: null,
		iconBackground: null,
		iconImage: null,
		iconMime: null,
	}
	if (!site?.icon_type || !site.icon) return { columns: none, partial: false }
	if (site.icon_type === 'emoji') {
		return {
			columns: {
				iconType: 'emoji',
				icon: site.icon,
				iconBackground: site.icon_background ?? null,
				iconImage: null,
				iconMime: null,
			},
			partial: false,
		}
	}
	if (site.icon_type === 'image' && site.icon_url) {
		try {
			const image = await fetchImage(site.icon_url)
			if (image) {
				return {
					columns: {
						iconType: 'image',
						icon: site.icon,
						iconBackground: site.icon_background ?? null,
						iconImage: image.bytes,
						iconMime: image.mime,
					},
					partial: false,
				}
			}
		} catch {
			// fall through: keep the previous icon
		}
		return { columns: undefined, partial: true }
	}
	return { columns: none, partial: false }
}

/**
 * `/site`'s `icon_url` as the URL to fetch. Dify builds it from FILES_URL, which is empty on a default self-hosted
 * install, so the link is relative (`/files/<id>/file-preview?timestamp=…&nonce=…&sign=…`) and resolves against the
 * API base's origin, as the remote-file route resolves relative links (WHATWG URL parsing with the origin as base);
 * an absolute link stays as Dify wrote it. Throws on a link that is not a URL, and the sync keeps the stored icon.
 */
const signedIconUrl = (iconUrl: string, apiBase: string): URL =>
	new URL(iconUrl, new URL(apiBase).origin)

/**
 * Dify's view of the app for the given credentials: info is required (a DifyError propagates), the site and its
 * icon are best effort. Icon columns left undefined mean the row keeps its icon, and `partial` says so.
 */
const fetchDifyProfile = async (
	credentials: DifyCredentials,
): Promise<{ info: AppInfo; iconColumns: IconColumns | undefined; partial: boolean }> => {
	const client = difyClient(credentials)
	const info = await client.getInfo()
	let site: SiteSettings | null
	try {
		site = await client.getSite()
	} catch (error) {
		if (!(error instanceof DifyError)) throw error
		// Any other failure (a 5xx, Dify unreachable, an unreadable body) says nothing about the icon: keep it.
		if (error.status !== 403) return { info, iconColumns: undefined, partial: true }
		// 403: the app has no site (no site row, or the workspace is archived; endpoint map §1.1), so no icon.
		site = null
	}
	// icon_url is a signed link from Dify's own answer: fetched without the app key, on whatever origin Dify built it.
	const { columns, partial } = await iconColumnsFrom(site, async url =>
		readIconBytes(await client.fetchSignedFile(signedIconUrl(url, credentials.apiBase))),
	)
	return { info, iconColumns: columns, partial }
}

/**
 * Name, description and tags from Dify, and the mode only when it is one of the six known modes (charter §4.4:
 * writes are validated; `AppInfo.mode` is only a type), so an unknown one leaves the stored mode alone.
 */
const infoColumns = (info: AppInfo) => ({
	name: info.name,
	...(isAppMode(info.mode) && { mode: info.mode }),
	description: info.description ?? null,
	tags: info.tags?.length ? JSON.stringify(info.tags) : null,
})

const settingsColumns = (settings: AppSettings) => ({
	enableAnswerForm: settings.answerForm.enabled,
	answerFormFeedbackText: settings.answerForm.feedbackText || null,
	enableUpdateInputAfterStarts: settings.enableUpdateAfterConversationStarts,
	openingStatementDisplayMode: settings.openingStatementDisplayMode,
	enableAnnotation: settings.annotationEnabled,
})

/** Builds the access rule's subqueries without a database instance (Drizzle docs, standalone query builder; decision d). */
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
				eq(difyApps.accessMode, 'everyone'),
				exists(
					qb
						.select({ one: sql`1` })
						.from(appUserGrants)
						.where(and(eq(appUserGrants.appId, difyApps.id), eq(appUserGrants.userId, actor.id))),
				),
				exists(
					qb
						.select({ one: sql`1` })
						.from(appGroupGrants)
						.innerJoin(userGroupMembers, eq(userGroupMembers.groupId, appGroupGrants.groupId))
						.where(
							and(eq(appGroupGrants.appId, difyApps.id), eq(userGroupMembers.userId, actor.id)),
						),
				),
			)

/** The access columns only: the Dify routes (with visibleTo), and the admin writes that re-read Dify with the stored key (without). */
const readAccess = async (id: string, visible?: SQL): Promise<AppAccess | null> => {
	const [row] = await getDb()
		.select({
			id: difyApps.id,
			isEnabled: difyApps.isEnabled,
			enableAnnotation: difyApps.enableAnnotation,
			apiBase: difyApps.apiBase,
			apiKey: difyApps.apiKey,
		})
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visible))
		.limit(1)
	return row
		? {
				id: row.id,
				enabled: row.isEnabled,
				annotationEnabled: row.enableAnnotation,
				credentials: { apiBase: row.apiBase, apiKey: row.apiKey },
			}
		: null
}

export async function listApps(actor: SessionUser): Promise<AppDto[]> {
	const rows = await getDb()
		.select(dtoColumns)
		.from(difyApps)
		.where(visibleTo(actor))
		.orderBy(desc(difyApps.createdAt))
	return rows.map(toAppDto)
}

/** Every app with its access, for /app-management (deviation 1). */
export async function listAdminApps(actor: SessionUser): Promise<AdminAppDto[]> {
	assertAdmin(actor)
	const db = getDb()
	const [rows, groupGrants, userGrants] = await Promise.all([
		db
			.select({ ...dtoColumns, accessMode: difyApps.accessMode })
			.from(difyApps)
			.orderBy(desc(difyApps.createdAt)),
		db
			.select({ appId: appGroupGrants.appId, groupId: appGroupGrants.groupId })
			.from(appGroupGrants),
		db.select({ appId: appUserGrants.appId, userId: appUserGrants.userId }).from(appUserGrants),
	])
	return toAdminAppDtos(rows, groupGrants, userGrants)
}

/** Null for a missing app and for one the actor may not use alike (spec §4.2: no difference to probe). */
export async function getChatApp(actor: SessionUser, id: string): Promise<ChatAppDto | null> {
	const [row] = await getDb()
		.select(dtoColumns)
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visibleTo(actor)))
		.limit(1)
	return row ? toChatAppDto(row) : null
}

/** For the Dify routes: the credentials never leave the server; null when missing or not the actor's to use. */
export async function getAppAccess(actor: SessionUser, id: string): Promise<AppAccess | null> {
	return readAccess(id, visibleTo(actor))
}

export async function getAppIcon(
	actor: SessionUser,
	id: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
	const [row] = await getDb()
		.select({ iconImage: difyApps.iconImage, iconMime: difyApps.iconMime })
		.from(difyApps)
		.where(and(eq(difyApps.id, id), visibleTo(actor)))
		.limit(1)
	return row?.iconImage && row.iconMime ? { bytes: row.iconImage, mime: row.iconMime } : null
}

/**
 * Creates the row from Dify's own info for the given credentials, with its grants in the same transaction (a deleted
 * group or account rejects it, 1452, and no app is left behind); rejects with DifyError when Dify refuses them.
 */
export async function createApp(
	actor: SessionUser,
	input: AppInput & { apiKey: string },
): Promise<SyncResult> {
	assertAdmin(actor)
	const credentials = { apiBase: input.apiBase, apiKey: input.apiKey }
	const { info, iconColumns, partial } = await fetchDifyProfile(credentials)
	const id = crypto.randomUUID()
	await getDb().transaction(async tx => {
		await tx.insert(difyApps).values({
			id,
			...infoColumns(info),
			// Dify reports the mode; the form's choice only decides when Dify's is not one of the known six.
			mode: isAppMode(info.mode) ? info.mode : input.mode,
			isEnabled: input.enabled,
			accessMode: input.access.mode,
			apiBase: input.apiBase,
			apiKey: input.apiKey,
			...settingsColumns(input.settings),
			...iconColumns,
		})
		await writeGrants(tx, id, input.access)
	})
	return { id, partial }
}

/**
 * Re-reads Dify with the effective credentials (a new key when given, else the stored one), then writes the row and
 * replaces its grants in one transaction under a lock on the row; null when the app is gone, before Dify or by the lock.
 */
export async function updateApp(
	actor: SessionUser,
	id: string,
	input: AppInput,
): Promise<SyncResult | null> {
	assertAdmin(actor)
	const access = await readAccess(id)
	if (!access) return null
	const credentials = { apiBase: input.apiBase, apiKey: input.apiKey || access.credentials.apiKey }
	// Dify is read before the transaction, so the row lock is held for the queries only.
	const { info, iconColumns, partial } = await fetchDifyProfile(credentials)
	const written = await getDb().transaction(async tx => {
		const [locked] = await lockApp(tx, id)
		if (!locked) return false
		await tx
			.update(difyApps)
			.set({
				...infoColumns(info),
				mode: isAppMode(info.mode) ? info.mode : input.mode,
				isEnabled: input.enabled,
				accessMode: input.access.mode,
				apiBase: credentials.apiBase,
				apiKey: credentials.apiKey,
				...settingsColumns(input.settings),
				...iconColumns,
			})
			.where(eq(difyApps.id, id))
		await writeGrants(tx, id, input.access)
		return true
	})
	return written ? { id, partial } : null
}

export async function deleteApp(actor: SessionUser, id: string): Promise<boolean> {
	assertAdmin(actor)
	const [result] = await getDb().delete(difyApps).where(eq(difyApps.id, id))
	return result.affectedRows > 0
}

/** Refreshes name, description, tags, a known mode and the icon from Dify; null when the app is gone. */
export async function syncApp(actor: SessionUser, id: string): Promise<SyncResult | null> {
	assertAdmin(actor)
	const access = await readAccess(id)
	if (!access) return null
	const { info, iconColumns, partial } = await fetchDifyProfile(access.credentials)
	await getDb()
		.update(difyApps)
		.set({ ...infoColumns(info), ...iconColumns })
		.where(eq(difyApps.id, id))
	return { id, partial }
}
