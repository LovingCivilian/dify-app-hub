import type { IGetAppInfoResponse } from '@/lib/api'

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
