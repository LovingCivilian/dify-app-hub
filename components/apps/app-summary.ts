import { type AppModeEnums, EIsEnabled, type IDifyAppItem } from '@/lib/core'

/** What an app card shows (spec §4.1) — nothing from requestConfig reaches the client. */
export type AppSummary =
	| {
			id: string
			missingInfo: false
			name: string
			description: string
			mode?: AppModeEnums
			tags: string[]
	  }
	| { id: string; missingInfo: true }

/** Enabled apps only, decided as `/chat`'s index does (`isEnabled !== EIsEnabled.disabled`), trimmed for the client. */
export const toAppSummaries = (items: IDifyAppItem[]): AppSummary[] =>
	items
		.filter(item => item.isEnabled !== EIsEnabled.disabled)
		.map(item =>
			item.info
				? {
						id: item.id,
						missingInfo: false,
						name: item.info.name,
						description: item.info.description ?? '',
						mode: item.info.mode,
						tags: item.info.tags ?? [],
					}
				: { id: item.id, missingInfo: true },
		)
