import 'server-only'

import { PROVIDER_SCHEMAS } from '../schemas'
import { aguiChat } from './chat'
import type { AguiSecrets, AguiSettings } from './schema'
import { testAguiConnection } from './test-connection'

/**
 * What the chat DTO carries of an AG-UI app's settings (Part 2 spec §2.2): whether the hub's `ask_user` tool is
 * advertised, which the chat reads to know a pending call waits for the user (decision 62); 2c adds the allowed
 * attachment kinds. Never the agent URL, the audience or the secret.
 */
export type AguiChatFields = { askUser: boolean }

/** What a gallery card carries (spec §2.2): nothing beyond the provider's name, "AG-UI agent" (AG-UI has no app types). */
export type AguiSummaryFields = Record<never, never>

/**
 * AG-UI agents as the server registry holds them (Part 2 spec §2.1, ADR-0032's checklist): their schemas, their
 * connection test (spec §2.4), what each DTO carries, which secret is set (never its value), and that the hub keeps their
 * conversations (spec §4.1), and how it runs a chat turn (spec §4.3).
 */
export const aguiProvider = {
	id: 'agui',
	...PROVIDER_SCHEMAS.agui,
	testConnection: testAguiConnection,
	chatFields: (settings: AguiSettings): AguiChatFields => ({ askUser: settings.askUser }),
	summaryFields: (): AguiSummaryFields => ({}),
	secretsSet: (secrets: AguiSecrets) => ({ jwtSecret: secrets.jwtSecret.length > 0 }),
	hubHistory: true,
	chat: aguiChat,
} as const
