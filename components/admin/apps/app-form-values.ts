import type { AppAccessSettings } from '@/lib/app-access'
import type { AdminAppDto } from '@/lib/data/apps'
import type { ProviderId } from '@/lib/providers/ids'
import { PROVIDER_SCHEMAS } from '@/lib/providers/schemas'

/**
 * The drawer's values (spec §4.1): the shared fields and, once a provider is picked, its settings and secrets. They
 * travel to the action as one JSON field (toAppFormData) and the server parses all of them again.
 */
export interface AppFormValues {
	provider?: ProviderId
	name: string
	description: string
	tags: string[]
	enabled: boolean
	access: AppAccessSettings
	settings?: Record<string, unknown>
	secrets?: Record<string, string>
}

/** The icon field's pending change; `url` is a new file's object URL for the preview (File API, URL.createObjectURL). */
export type IconDraft =
	| { intent: 'keep' }
	| { intent: 'remove' }
	| { intent: 'replace'; file: File; url: string }

/** Layout B (decision 29): a new app starts with no provider; its sections appear once one is picked. */
export const DEFAULT_APP_FORM_VALUES: AppFormValues = {
	name: '',
	description: '',
	tags: [],
	enabled: true,
	// B3 spec §2 #9: a new app is closed, restricted with no grant, until the admin opens it.
	access: { mode: 'restricted', groupIds: [], userIds: [] },
}

/** A provider's documents as the form starts them: when it is picked, and to repair an invalid row (MDN structuredClone). */
export const providerDefaults = (
	provider: ProviderId,
): Required<Pick<AppFormValues, 'settings' | 'secrets'>> => ({
	settings: structuredClone(PROVIDER_SCHEMAS[provider].defaultSettings),
	secrets: { ...PROVIDER_SCHEMAS[provider].defaultSecrets },
})

/**
 * A saved app as the form's values. The stored secrets never come back to the browser, so their fields start blank (a
 * blank keeps them, spec §2.3); an invalid row opens on its provider's defaults so the admin can repair it.
 */
export const toAppFormValues = (app: AdminAppDto): AppFormValues => ({
	provider: app.provider,
	name: app.name,
	description: app.description,
	tags: app.tags,
	enabled: app.enabled,
	access: app.access,
	...providerDefaults(app.provider),
	...(app.invalid ? {} : { settings: app.settings }),
})

/** The action's FormData (spec §4.3): the values as JSON, the icon intent and, for a replacement, the file. */
export const toAppFormData = (values: AppFormValues, icon: IconDraft): FormData => {
	const data = new FormData()
	data.set('values', JSON.stringify(values))
	data.set('iconIntent', icon.intent)
	if (icon.intent === 'replace') data.set('icon', icon.file)
	return data
}
