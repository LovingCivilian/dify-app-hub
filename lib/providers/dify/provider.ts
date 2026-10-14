import 'server-only'

import { PROVIDER_SCHEMAS } from '../schemas'
import type { DifySecrets, DifySettings } from './schema'
import { testDifyConnection } from './test-connection'

/**
 * Dify as the server registry holds it (Part 1 spec §3): its schemas, its connection test, and what of its documents each
 * DTO carries (spec §2.3): the chat gets the type and the three chat switches, never the base or the key; the gallery
 * the type; the admin which secrets are set, never their values (DV 10, OWASP ASVS 14.2.6).
 */
export const difyProvider = {
	id: 'dify',
	...PROVIDER_SCHEMAS.dify,
	testConnection: testDifyConnection,
	chatFields: (settings: DifySettings) => ({
		appType: settings.appType,
		settings: {
			answerForm: settings.answerForm,
			enableUpdateAfterConversationStarts: settings.enableUpdateAfterConversationStarts,
			openingStatementDisplayMode: settings.openingStatementDisplayMode,
		},
	}),
	summaryFields: (settings: DifySettings) => ({ appType: settings.appType }),
	secretsSet: (secrets: DifySecrets) => ({ apiKey: secrets.apiKey.length > 0 }),
} as const
