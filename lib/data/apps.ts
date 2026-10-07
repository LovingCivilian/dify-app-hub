import 'server-only'

import { desc, eq, sql } from 'drizzle-orm'

import { getDb } from '@/db'
import { difyApps } from '@/db/schema'
import type { SessionUser } from '@/lib/auth/session'
import { difyClient, type DifyCredentials } from '@/lib/dify/client'
import { DifyError } from '@/lib/dify/errors'
import { isAppMode, type AppInfo, type AppMode, type SiteSettings } from '@/lib/dify/types'

/*
 * The apps Data Access Layer (charter §4.2). Every function takes the verified actor first: the entry point
 * (route, action, page) verifies the session once, and nothing here can be called without a SessionUser. B1
 * has no roles, so `_actor` is not read yet; B2 reads its role here.
 */

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
type DtoRow = Omit<AppRow, 'apiKey' | 'iconImage' | 'iconMime'> & { hasIconImage: boolean }

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
	credentials: DifyCredentials
}

/** What the admin form sends (validated by the action's schema). `apiKey` is required on create, optional on update. */
export interface AppInput {
	apiBase: string
	apiKey?: string
	mode: AppMode
	enabled: boolean
	settings: AppSettings
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
		readIconBytes(await client.fetchSignedFile(new URL(url))),
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

const selectDtoRow = async (id: string): Promise<DtoRow | undefined> => {
	const [row] = await getDb().select(dtoColumns).from(difyApps).where(eq(difyApps.id, id)).limit(1)
	return row
}

/** The access columns only: the Dify routes, and the writes that re-read Dify with the stored key. */
const readAccess = async (id: string): Promise<AppAccess | null> => {
	const [row] = await getDb()
		.select({
			id: difyApps.id,
			isEnabled: difyApps.isEnabled,
			apiBase: difyApps.apiBase,
			apiKey: difyApps.apiKey,
		})
		.from(difyApps)
		.where(eq(difyApps.id, id))
		.limit(1)
	return row
		? {
				id: row.id,
				enabled: row.isEnabled,
				credentials: { apiBase: row.apiBase, apiKey: row.apiKey },
			}
		: null
}

export async function listApps(_actor: SessionUser): Promise<AppDto[]> {
	const rows = await getDb().select(dtoColumns).from(difyApps).orderBy(desc(difyApps.createdAt))
	return rows.map(toAppDto)
}

export async function getApp(_actor: SessionUser, id: string): Promise<AppDto | null> {
	const row = await selectDtoRow(id)
	return row ? toAppDto(row) : null
}

export async function getChatApp(_actor: SessionUser, id: string): Promise<ChatAppDto | null> {
	const row = await selectDtoRow(id)
	return row ? toChatAppDto(row) : null
}

/** For the Dify routes: the credentials never leave the server. */
export async function getAppAccess(_actor: SessionUser, id: string): Promise<AppAccess | null> {
	return readAccess(id)
}

export async function getAppIcon(
	_actor: SessionUser,
	id: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
	const [row] = await getDb()
		.select({ iconImage: difyApps.iconImage, iconMime: difyApps.iconMime })
		.from(difyApps)
		.where(eq(difyApps.id, id))
		.limit(1)
	return row?.iconImage && row.iconMime ? { bytes: row.iconImage, mime: row.iconMime } : null
}

/** Creates the row from Dify's own info for the given credentials; rejects with DifyError when Dify refuses them. */
export async function createApp(
	_actor: SessionUser,
	input: AppInput & { apiKey: string },
): Promise<SyncResult> {
	const credentials = { apiBase: input.apiBase, apiKey: input.apiKey }
	const { info, iconColumns, partial } = await fetchDifyProfile(credentials)
	const id = crypto.randomUUID()
	await getDb()
		.insert(difyApps)
		.values({
			id,
			...infoColumns(info),
			// Dify reports the mode; the form's choice only decides when Dify's is not one of the known six.
			mode: isAppMode(info.mode) ? info.mode : input.mode,
			isEnabled: input.enabled,
			apiBase: input.apiBase,
			apiKey: input.apiKey,
			...settingsColumns(input.settings),
			...iconColumns,
		})
	return { id, partial }
}

/** Re-reads Dify with the effective credentials (a new key when given, else the stored one); null when the app is gone. */
export async function updateApp(
	_actor: SessionUser,
	id: string,
	input: AppInput,
): Promise<SyncResult | null> {
	const access = await readAccess(id)
	if (!access) return null
	const credentials = { apiBase: input.apiBase, apiKey: input.apiKey || access.credentials.apiKey }
	const { info, iconColumns, partial } = await fetchDifyProfile(credentials)
	await getDb()
		.update(difyApps)
		.set({
			...infoColumns(info),
			mode: isAppMode(info.mode) ? info.mode : input.mode,
			isEnabled: input.enabled,
			apiBase: credentials.apiBase,
			apiKey: credentials.apiKey,
			...settingsColumns(input.settings),
			...iconColumns,
		})
		.where(eq(difyApps.id, id))
	return { id, partial }
}

export async function deleteApp(_actor: SessionUser, id: string): Promise<boolean> {
	const [result] = await getDb().delete(difyApps).where(eq(difyApps.id, id))
	return result.affectedRows > 0
}

/** Refreshes name, description, tags, a known mode and the icon from Dify; null when the app is gone. */
export async function syncApp(_actor: SessionUser, id: string): Promise<SyncResult | null> {
	const access = await readAccess(id)
	if (!access) return null
	const { info, iconColumns, partial } = await fetchDifyProfile(access.credentials)
	await getDb()
		.update(difyApps)
		.set({ ...infoColumns(info), ...iconColumns })
		.where(eq(difyApps.id, id))
	return { id, partial }
}
