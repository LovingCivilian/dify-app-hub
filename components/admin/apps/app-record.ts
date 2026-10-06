import type { IAnnotationItem, IGetAnnotationListResponse, IGetAppInfoResponse } from '@/lib/api'
import type { IDifyAppItem } from '@/lib/core'

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * lib/api parses any JSON answer (base-request.ts `jsonRequest`), so Dify's error body for a refused key or a
 * wrong path arrives as a value. App info is recognised by its string name before anything is saved.
 */
export const isAppInfo = (value: unknown): value is IGetAppInfoResponse =>
	isRecord(value) && typeof value.name === 'string'

/** actions.ts `updateApp` (upstream's) resolves `{ success: false, message }` instead of throwing. */
export const isFailedUpdate = (result: unknown) => isRecord(result) && result.success === false

/** A drawer that needs the full app: the id it was opened for, and the record once getApp answered. */
export type RecordState = { appId: string; record?: IDifyAppItem } | null

/** A getApp answer fills the drawer only if it is still open for that app. */
export const acceptRecord = (
	current: RecordState,
	appId: string,
	record: IDifyAppItem,
): RecordState => (current?.appId === appId ? { appId, record } : current)

/** A failed getApp closes the drawer only if it still waits for that app. */
export const dropRecord = (current: RecordState, appId: string): RecordState =>
	current?.appId === appId ? null : current

/** GET /apps/annotations answered a page (data array + total), not an error body. */
export const isAnnotationPage = (value: unknown): value is IGetAnnotationListResponse =>
	isRecord(value) && Array.isArray(value.data) && typeof value.total === 'number'

/** A saved annotation echoed back by Dify's create or update, not an error body. */
export const isAnnotationItem = (value: unknown): value is IAnnotationItem =>
	isRecord(value) && typeof value.id === 'string'
