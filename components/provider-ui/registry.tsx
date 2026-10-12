'use client'

import { ApartmentOutlined, AppstoreOutlined } from '@ant-design/icons'
import type { TFunction } from 'i18next'
import type { ComponentType } from 'react'

import { isProviderId, type ProviderId } from '@/lib/providers/ids'

import { APP_MODE_NAME_KEYS } from './dify/app-types'

/*
 * The client half of the provider registry (Part 1 spec §3): what the gallery and the admin table show of a provider,
 * its name, its fallback icon (E11) and the names of its app types. The chat views (provider-chat.tsx) and the admin
 * form sections (provider-form-section.tsx, Task 12) live in modules of their own: once a file is marked "use client",
 * "all of its imports and the components it directly renders are included in the client bundle" (Next "Server and Client
 * Components"), and the gallery should not carry the chat. `satisfies` keeps the map exhaustive over ProviderId (DV 11);
 * `as const` keeps each key a literal, which the typed `t()` requires (types/i18next.d.ts).
 */
export const PROVIDER_UI = {
	dify: { labelKey: 'provider.dify', Icon: ApartmentOutlined, typeLabelKeys: APP_MODE_NAME_KEYS },
} as const satisfies Record<
	ProviderId,
	{ labelKey: string; Icon: ComponentType; typeLabelKeys: Readonly<Record<string, string>> }
>

/** E11: the icon of an app whose provider the browser does not know. */
export const GenericAppIcon = AppstoreOutlined

/** The icon an app without a stored image shows (E11): its provider's, or the generic one. */
export const providerIcon = (provider: string): ComponentType =>
	isProviderId(provider) ? PROVIDER_UI[provider].Icon : GenericAppIcon

/** E9 and E10: the provider's name and, when the provider has types and the app's is known, the type ("Dify · Chatflow"). */
export const providerLine = (t: TFunction, provider: ProviderId, appType?: string): string => {
	const ui = PROVIDER_UI[provider]
	const typeKey =
		appType !== undefined && Object.hasOwn(ui.typeLabelKeys, appType)
			? ui.typeLabelKeys[appType as keyof typeof ui.typeLabelKeys]
			: undefined
	return typeKey ? `${t(ui.labelKey)} · ${t(typeKey)}` : t(ui.labelKey)
}
