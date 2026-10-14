import 'server-only'

import { PROVIDER_SCHEMAS } from '../schemas'
import type { DifySecrets, DifySettings } from './schema'
import { testDifyConnection } from './test-connection'

/** What the chat DTO carries of Dify's settings (spec §2.3): the type and the three chat switches. */
export type DifyChatFields = {
	appType: DifySettings['appType']
	settings: Pick<
		DifySettings,
		'answerForm' | 'enableUpdateAfterConversationStarts' | 'openingStatementDisplayMode'
	>
}

/** What a gallery card carries of Dify's settings (E10): the type. */
export type DifySummaryFields = { appType: DifySettings['appType'] }

/**
 * Dify as the server registry holds it (Part 1 spec §3): its schemas, its connection test, and what of its documents each
 * DTO carries (spec §2.3): the chat gets the type and the three chat switches, never the base or the key; the gallery
 * the type; the admin which secrets are set, never their values (DV 10, OWASP ASVS 14.2.6). The hub keeps no history of
 * a Dify conversation until Part 3 moves Dify onto the shared chat (Part 2 spec §4.1).
 */
export const difyProvider = {
	id: 'dify',
	...PROVIDER_SCHEMAS.dify,
	testConnection: testDifyConnection,
	chatFields: (settings: DifySettings): DifyChatFields => ({
		appType: settings.appType,
		settings: {
			answerForm: settings.answerForm,
			enableUpdateAfterConversationStarts: settings.enableUpdateAfterConversationStarts,
			openingStatementDisplayMode: settings.openingStatementDisplayMode,
		},
	}),
	summaryFields: (settings: DifySettings): DifySummaryFields => ({ appType: settings.appType }),
	secretsSet: (secrets: DifySecrets) => ({ apiKey: secrets.apiKey.length > 0 }),
	hubHistory: false,
} as const
