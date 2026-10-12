'use client'

import { Avatar } from 'antd'

import { providerIcon } from '@/components/provider-ui/registry'

/** The stored icon image's URL (charter §4.4). */
export const appIconUrl = (appId: string) => `/api/apps/${encodeURIComponent(appId)}/icon`

/**
 * An app's icon (Part 1 spec §5, E11): the stored image through the icon route, or its provider's fallback icon on the
 * square Avatar's default grey, at today's sizes. Emoji icons are gone (decision 19).
 */
export default function AppIcon({
	appId,
	provider,
	hasIcon,
	size = 'large',
}: {
	appId: string
	provider: string
	hasIcon: boolean
	size?: 'large' | 'small'
}) {
	if (hasIcon) {
		return (
			<Avatar
				shape="square"
				size={size}
				src={appIconUrl(appId)}
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
