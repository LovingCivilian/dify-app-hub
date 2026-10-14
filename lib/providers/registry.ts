import 'server-only'

import type { ConnectionTestResult } from './connection'
import { difyProvider } from './dify/provider'
import type { ProviderId } from './ids'
import type { ProviderSecrets, ProviderSettings } from './schemas'

/**
 * What the server knows of each provider (Part 1 spec §3): the schemas (lib/providers/schemas.ts), the connection test,
 * and the DTO fields its settings give (Plan decision e). The neutral data layer, the route guard and the actions reach a
 * provider only through here (spec §11). Server-only (DV 9a: the registry, testConnection and the clients).
 */
export interface ProviderDefinition<P extends ProviderId> {
	id: P
	testConnection: (
		settings: ProviderSettings<P>,
		secrets: ProviderSecrets<P>,
	) => Promise<ConnectionTestResult>
	chatFields: (settings: ProviderSettings<P>) => object
	summaryFields: (settings: ProviderSettings<P>) => object
	secretsSet: (secrets: ProviderSecrets<P>) => Record<string, boolean>
}

/**
 * One definition per provider id: `satisfies` over the mapped type makes the map exhaustive (DV 11), as LobeHub's
 * `providerRuntimeMap` and LibreChat's `providerConfigMap` are maps from type to adapter; unlike LobeHub's
 * `runtimeMap[provider] ?? LobeOpenAI`, an unknown id has no fallback here (neutral code narrows with `isProviderId` first).
 */
export const PROVIDERS = {
	dify: difyProvider,
} satisfies { [P in ProviderId]: ProviderDefinition<P> }

export type ProviderChatFields<P extends ProviderId> = ReturnType<
	(typeof PROVIDERS)[P]['chatFields']
>
export type ProviderSummaryFields<P extends ProviderId> = ReturnType<
	(typeof PROVIDERS)[P]['summaryFields']
>
export type ProviderSecretsSet<P extends ProviderId> = ReturnType<
	(typeof PROVIDERS)[P]['secretsSet']
>
