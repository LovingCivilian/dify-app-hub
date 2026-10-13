'use client'

import type { ProviderId } from '@/lib/providers/ids'

import DifyFormSection from './dify/form-section'

/**
 * The admin form's half of the client registry (Part 1 spec §3): the picked provider's sections, after the shared ones.
 * A module of its own, so the gallery's registry does not carry the admin form (Next "Server and Client Components":
 * a client module's imports are all in the bundle). An exhaustive switch: a provider without a section fails tsc.
 */
export default function ProviderFormSection({
	provider,
	appId,
	editing,
}: {
	provider: ProviderId
	appId?: string
	editing: boolean
}) {
	switch (provider) {
		case 'dify':
			return (
				<DifyFormSection
					appId={appId}
					editing={editing}
				/>
			)
		default:
			return provider satisfies never
	}
}
