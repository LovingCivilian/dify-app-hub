import 'server-only'

import { aguiProvider, type AguiChatFields, type AguiSummaryFields } from './agui/provider'
import type { ProviderCaller } from './caller'
import type { ConnectionTestResult } from './connection'
import { difyProvider, type DifyChatFields, type DifySummaryFields } from './dify/provider'
import type { ProviderId } from './ids'
import type { ProviderSecrets, ProviderSettings } from './schemas'

/** What the chat DTO carries of each provider's settings (Part 2 spec §2.5, issue #62: typed per provider). */
interface ProviderChatFieldsMap {
	dify: DifyChatFields
	agui: AguiChatFields
}

/** What a gallery card carries of each provider's settings (spec §2.5, issue #62). */
interface ProviderSummaryFieldsMap {
	dify: DifySummaryFields
	agui: AguiSummaryFields
}

export type ProviderChatFields<P extends ProviderId> = ProviderChatFieldsMap[P]
export type ProviderSummaryFields<P extends ProviderId> = ProviderSummaryFieldsMap[P]
/** Which of a provider's secrets are set, never their values (DV 10): one flag per secret field. */
export type ProviderSecretsSet<P extends ProviderId> = Record<keyof ProviderSecrets<P>, boolean>

/**
 * What the server knows of each provider (Part 1 spec §3): the schemas (lib/providers/schemas.ts), the connection test,
 * and the DTO fields its settings give (Plan decision e). The neutral data layer, the route guard and the actions reach a
 * provider only through here (spec §11). Server-only (DV 9a: the registry, testConnection and the clients). Part 2 adds
 * the caller to the test (an AG-UI token names the admin running it, spec §2.4) and `hubHistory` (spec §4.1).
 */
export interface ProviderDefinition<P extends ProviderId> {
	id: P
	testConnection: (
		settings: ProviderSettings<P>,
		secrets: ProviderSecrets<P>,
		caller: ProviderCaller,
	) => Promise<ConnectionTestResult>
	chatFields: (settings: ProviderSettings<P>) => ProviderChatFields<P>
	summaryFields: (settings: ProviderSettings<P>) => ProviderSummaryFields<P>
	secretsSet: (secrets: ProviderSecrets<P>) => ProviderSecretsSet<P>
	/** Spec §4.1: the hub keeps this provider's conversations (the shared chat's store; 2c's Logs read it). */
	hubHistory: boolean
}

/**
 * One definition per provider id: `satisfies` over the mapped type makes the map exhaustive (DV 11), as LobeHub's
 * `providerRuntimeMap` and LibreChat's `providerConfigMap` are maps from type to adapter; unlike LobeHub's
 * `runtimeMap[provider] ?? LobeOpenAI`, an unknown id has no fallback here (neutral code narrows with `isProviderId` first).
 */
export const PROVIDERS = {
	dify: difyProvider,
	agui: aguiProvider,
} satisfies { [P in ProviderId]: ProviderDefinition<P> }

/**
 * A provider's definition for an id that is a type parameter. Through a map annotated with the mapped type, `REGISTRY[id]`
 * reads as `ProviderDefinition<P>` (TypeScript 4.6 release notes, "Indexed Access Inference Improvements", and
 * microsoft/TypeScript#47109), so a call with that provider's documents type-checks for every provider at once; a call
 * on `PROVIDERS[provider]` with a union `provider` would need the intersection of all the providers' settings.
 */
const REGISTRY: { [P in ProviderId]: ProviderDefinition<P> } = PROVIDERS

export const providerDefinition = <P extends ProviderId>(id: P): ProviderDefinition<P> =>
	REGISTRY[id]
