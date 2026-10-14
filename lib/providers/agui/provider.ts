import 'server-only'

import { PROVIDER_SCHEMAS } from '../schemas'
import type { AguiSecrets } from './schema'
import { testAguiConnection } from './test-connection'

/**
 * What the chat DTO carries of an AG-UI app's settings (Part 2 spec §2.2): nothing in 2a; 2b adds `askUser` and 2c the
 * allowed attachment kinds. Never the agent URL, the audience or the secret.
 */
export type AguiChatFields = Record<never, never>

/** What a gallery card carries (spec §2.2): nothing beyond the provider's name, "AG-UI agent" (AG-UI has no app types). */
export type AguiSummaryFields = Record<never, never>

/**
 * AG-UI agents as the server registry holds them (Part 2 spec §2.1, ADR-0032's checklist): their schemas, their
 * connection test (spec §2.4), what each DTO carries, which secret is set (never its value), and that the hub keeps their
 * conversations (spec §4.1). The chat adapter joins in Task 9.
 */
export const aguiProvider = {
	id: 'agui',
	...PROVIDER_SCHEMAS.agui,
	testConnection: testAguiConnection,
	chatFields: (): AguiChatFields => ({}),
	summaryFields: (): AguiSummaryFields => ({}),
	secretsSet: (secrets: AguiSecrets) => ({ jwtSecret: secrets.jwtSecret.length > 0 }),
	hubHistory: true,
} as const
