'use client'

import {
	ApartmentOutlined,
	AppstoreOutlined,
	DeploymentUnitOutlined,
	FileTextOutlined,
	MessageOutlined,
	RobotOutlined,
} from '@ant-design/icons'
import { Avatar, Skeleton } from 'antd'
import { useEffect, useState } from 'react'

import { AppModeEnums } from '@/lib/core'

import { type AppIconKind, toAppIconKind } from './app-icon-kind'

const MODE_ICONS: Record<AppModeEnums, React.ReactNode> = {
	[AppModeEnums.CHATBOT]: <MessageOutlined />,
	[AppModeEnums.AGENT]: <RobotOutlined />,
	[AppModeEnums.CHATFLOW]: <ApartmentOutlined />,
	[AppModeEnums.WORKFLOW]: <DeploymentUnitOutlined />,
	[AppModeEnums.TEXT_GENERATOR]: <FileTextOutlined />,
}

/**
 * The app's Dify icon from its site settings through the existing proxy route, or its mode icon when the app
 * has none (spec §4.3). One request per rendered icon (spec §12 records the sync-time alternative).
 */
export default function AppIcon({
	appId,
	mode,
	size = 'large',
}: {
	appId: string
	mode?: AppModeEnums
	size?: 'large' | 'small'
}) {
	const [icon, setIcon] = useState<AppIconKind>()

	useEffect(() => {
		const controller = new AbortController()
		fetch(`/api/client/dify/${appId}/site`, { signal: controller.signal })
			.then(response => response.json())
			.then(answer => setIcon(toAppIconKind(answer)))
			.catch(() => {
				if (!controller.signal.aborted) setIcon({ kind: 'mode' })
			})
		return () => controller.abort()
	}, [appId])

	if (!icon) {
		return (
			<Skeleton.Avatar
				active
				shape="square"
				size={size}
			/>
		)
	}
	if (icon.kind === 'emoji') {
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
	if (icon.kind === 'image') {
		return (
			<Avatar
				shape="square"
				size={size}
				src={icon.src}
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
