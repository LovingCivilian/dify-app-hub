'use client'

import { ApartmentOutlined, AppstoreOutlined, RobotOutlined } from '@ant-design/icons'
import type { TFunction } from 'i18next'
import type { ComponentType } from 'react'

import type { AdminAppDto } from '@/lib/data/apps'
import { isAppMode } from '@/lib/providers/dify/types'
import { isProviderId, type ProviderId } from '@/lib/providers/ids'

import { APP_MODE_NAME_KEYS, APP_MODE_OPTIONS } from './dify/app-types'

/*
 * The client half of the provider registry (Part 1 spec §3): what the gallery and the admin table show of a provider,
 * its name, its fallback icon (E11) and its app types, if it has any (AG-UI has none, Part 2 spec §2.2). The chat views
 * (provider-chat.tsx) and the admin form sections (provider-form-section.tsx) live in modules of their own: once a file
 * is marked "use client", "all of its imports and the components it directly renders are included in the client bundle"
 * (Next "Server and Client Components"), and the gallery should not carry the chat. `satisfies` keeps the map exhaustive
 * over ProviderId (DV 11); `as const` keeps each key a literal, which the typed `t()` requires (types/i18next.d.ts).
 */
export const PROVIDER_UI = {
	dify: {
		labelKey: 'provider.dify',
		Icon: ApartmentOutlined,
		/** The order the table's filter lists the types in: Dify's console order (the admin form's choices). */
		types: APP_MODE_OPTIONS,
	},
	agui: {
		labelKey: 'provider.agui',
		// Part 1's E11: a fallback icon per provider; Part 2 spec §2.1 names RobotOutlined for AG-UI agents.
		Icon: RobotOutlined,
		types: [],
	},
} as const satisfies Record<
	ProviderId,
	{
		labelKey: string
		Icon: ComponentType
		types: readonly string[]
	}
>

/** E11: the icon of an app whose provider the browser does not know. */
export const GenericAppIcon = AppstoreOutlined

/** The icon an app without a stored image shows (E11): its provider's, or the generic one. */
export const providerIcon = (provider: string): ComponentType =>
	isProviderId(provider) ? PROVIDER_UI[provider].Icon : GenericAppIcon

/**
 * A type's translation key for the provider, or undefined for a type the client does not know (Part 2 spec §2.5, issue
 * #62: Dify's lookup narrows the type with its own guard, `isAppMode`, instead of casting it). AG-UI has no types.
 */
const typeLabelKey = (provider: ProviderId, type: string) => {
	switch (provider) {
		case 'dify':
			return isAppMode(type) ? APP_MODE_NAME_KEYS[type] : undefined
		case 'agui':
			return undefined
		default:
			// TypeScript handbook, Narrowing > "Exhaustiveness checking"; `satisfies` is the TS 4.9 operator.
			return provider satisfies never
	}
}

/** E9 and E10: the provider's name and, when the provider has types and the app's is known, the type ("Dify · Chatflow"). */
export const providerLine = (t: TFunction, provider: ProviderId, appType?: string): string => {
	const label = t(PROVIDER_UI[provider].labelKey)
	const key = appType === undefined ? undefined : typeLabelKey(provider, appType)
	return key ? `${label} · ${t(key)}` : label
}

/** A type's name for the provider (E7's warning): the translation, or the provider's raw value for a type the client does not know. */
export const typeName = (t: TFunction, provider: ProviderId, type: string): string => {
	const key = typeLabelKey(provider, type)
	return key ? t(key) : type
}

/** The app's type as its provider's settings hold it, for the table (E9); none for an app whose documents failed. */
export const adminAppType = (app: AdminAppDto): string | undefined => {
	if (app.invalid) return undefined
	switch (app.provider) {
		case 'dify':
			return app.settings.appType
		case 'agui':
			// Part 2 spec §2.2: AG-UI agents have no app types.
			return undefined
		default:
			// TypeScript handbook, Narrowing > "Exhaustiveness checking"; `satisfies` is the TS 4.9 operator.
			return app satisfies never
	}
}
