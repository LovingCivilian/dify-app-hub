import type { AppDto, AppIcon } from '@/lib/data/apps'
import type { AppMode } from '@/lib/dify/types'

/** What an app card shows: the DTO minus the base and the settings. */
export interface AppSummary {
	id: string
	name: string
	description: string
	mode: AppMode | null
	tags: string[]
	icon: AppIcon
}

/** Enabled apps only, trimmed for the client. */
export const toAppSummaries = (apps: AppDto[]): AppSummary[] =>
	apps
		.filter(app => app.enabled)
		.map(({ id, name, description, mode, tags, icon }) => ({
			id,
			name,
			description,
			mode,
			tags,
			icon,
		}))
