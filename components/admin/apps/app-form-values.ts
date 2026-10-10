import type { AppFormInput } from '@/app/(admin)/app-management/schemas'
import type { AdminAppDto } from '@/lib/data/apps'

/** The drawer's values are the action's input: field names are paths in AppFormInput. */
export type AppFormValues = AppFormInput

export const DEFAULT_APP_FORM_VALUES: AppFormValues = {
	apiBase: '',
	apiKey: '',
	mode: 'chat',
	enabled: true,
	settings: {
		answerForm: { enabled: false, feedbackText: '' },
		enableUpdateAfterConversationStarts: false,
		openingStatementDisplayMode: 'default',
		annotationEnabled: false,
	},
	// Spec §2 #9: a new app is closed, restricted with no grant, until the admin opens it.
	access: { mode: 'restricted', groupIds: [], userIds: [] },
}

/** A saved app as the form's initial values. The stored key is never shown: a blank key keeps it (updateApp). */
export const toAppFormValues = (app: AdminAppDto): AppFormValues => ({
	apiBase: app.apiBase,
	apiKey: '',
	mode: app.mode ?? 'chat',
	enabled: app.enabled,
	settings: app.settings,
	access: app.access,
})
