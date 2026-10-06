export type AppIconKind =
	| { kind: 'emoji'; emoji: string; background?: string }
	| { kind: 'image'; src: string }
	| { kind: 'mode' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
const filled = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/**
 * The icon an app's Dify site names (GET /api/client/dify/{id}/site answers `{ code, data }`).
 * Dify's IconType is image | emoji | link (api/models/model.py); `icon_url` is set only for image
 * (api/controllers/common/fields.py). Anything else — Dify's 403 without a site, an error body, an older Dify —
 * is the mode icon (spec §4.3).
 */
export const toAppIconKind = (answer: unknown): AppIconKind => {
	const site = isRecord(answer) && isRecord(answer.data) ? answer.data : undefined
	if (!site) return { kind: 'mode' }
	if (site.icon_type === 'emoji' && filled(site.icon)) {
		return {
			kind: 'emoji',
			emoji: site.icon,
			background: filled(site.icon_background) ? site.icon_background : undefined,
		}
	}
	if (site.icon_type === 'image' && filled(site.icon_url))
		return { kind: 'image', src: site.icon_url }
	if (site.icon_type === 'link' && filled(site.icon)) return { kind: 'image', src: site.icon }
	return { kind: 'mode' }
}
