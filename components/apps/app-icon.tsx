'use client'

import {
	ApartmentOutlined,
	AppstoreOutlined,
	DeploymentUnitOutlined,
	FileTextOutlined,
	MessageOutlined,
	RobotOutlined,
} from '@ant-design/icons'
import { Avatar } from 'antd'

import type { AppIcon as AppIconData } from '@/lib/data/apps'
import type { AppMode } from '@/lib/dify/types'

const MODE_ICONS: Record<AppMode, React.ReactNode> = {
	chat: <MessageOutlined />,
	'agent-chat': <RobotOutlined />,
	'advanced-chat': <ApartmentOutlined />,
	workflow: <DeploymentUnitOutlined />,
	completion: <FileTextOutlined />,
	agent: <RobotOutlined />,
}

/** The stored icon image's URL (charter §4.4). */
export const appIconUrl = (appId: string) => `/api/apps/${encodeURIComponent(appId)}/icon`

/** The app's stored Dify icon (an emoji, or the image through the icon route), or its mode icon when it has none. */
export default function AppIcon({
	appId,
	icon,
	mode,
	size = 'large',
}: {
	appId: string
	icon: AppIconData
	mode: AppMode | null
	size?: 'large' | 'small'
}) {
	if (icon?.kind === 'emoji') {
		// icon_background is Dify data (the colour the admin picked), passed through style, not a literal here.
		return (
			<Avatar
				shape="square"
				size={size}
				style={icon.background ? { backgroundColor: icon.background } : undefined}
			>
				{icon.emoji}
			</Avatar>
		)
	}
	if (icon?.kind === 'image') {
		return (
			<Avatar
				shape="square"
				size={size}
				src={appIconUrl(appId)}
				alt=""
			/>
		)
	}
	return (
		<Avatar
			shape="square"
			size={size}
			icon={mode ? MODE_ICONS[mode] : <AppstoreOutlined />}
		/>
	)
}
