'use client'

import { Avatar } from 'antd'

import { providerIcon } from '@/components/provider-ui/registry'

/**
 * The stored icon image's URL (charter §4.4). The admin views pass the DTO's `updatedAt` as `version`: the URL then
 * changes after a replace, so the <img> reloads after `router.refresh()` (ADR-0023, "Icon staleness"). The route
 * ignores the query string.
 */
export const appIconUrl = (appId: string, version?: string) =>
	`/api/apps/${encodeURIComponent(appId)}/icon${version ? `?v=${encodeURIComponent(version)}` : ''}`

/**
 * An app's icon (Part 1 spec §5, E11): the stored image through the icon route, or its provider's fallback icon on the
 * square Avatar's default grey, at today's sizes. Emoji icons are gone (decision 19).
 */
export default function AppIcon({
	appId,
	provider,
	hasIcon,
	version,
	size = 'large',
}: {
	appId: string
	provider: string
	hasIcon: boolean
	/** The DTO's `updatedAt`, where the DTO in hand carries one (the admin views). */
	version?: string
	size?: 'large' | 'small'
}) {
	if (hasIcon) {
		return (
			<Avatar
				shape="square"
				size={size}
				src={appIconUrl(appId, version)}
				alt=""
			/>
		)
	}
	const Icon = providerIcon(provider)
	return (
		<Avatar
			shape="square"
			size={size}
			icon={<Icon />}
		/>
	)
}
