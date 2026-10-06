import { AppModeEnums, type EIsEnabled, type IDifyAppItem } from '@/lib/core'

/**
 * One row of the admin app table (spec §5.1). No requestConfig: edit, sync and annotations fetch the full
 * record with getApp(id) when the admin opens them. A row without info shows empty fields.
 */
export interface AdminAppRow {
	id: string
	name: string
	mode?: AppModeEnums
	description: string
	tags: string[]
	isEnabled: EIsEnabled
}

export const toAdminAppRows = (
	items: Pick<IDifyAppItem, 'id' | 'info' | 'isEnabled'>[],
): AdminAppRow[] =>
	items.map(item => ({
		id: item.id,
		name: item.info?.name ?? '',
		mode: item.info?.mode,
		description: item.info?.description ?? '',
		tags: item.info?.tags ?? [],
		isEnabled: item.isEnabled,
	}))

/** Dify documents GET /apps/annotations for chatbot, chatflow and the legacy agent apps. */
export const supportsAnnotations = (mode?: AppModeEnums) =>
	mode === AppModeEnums.CHATBOT || mode === AppModeEnums.CHATFLOW || mode === AppModeEnums.AGENT
