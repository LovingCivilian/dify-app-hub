'use client'

import { AppstoreOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Dropdown, message, Segmented, Space } from 'antd'
import type { ParseKeys } from 'i18next'
import { signOut, useSession } from 'next-auth/react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

enum ETopMenuKeys {
	AppManagement = 'app-management',
	UserManagement = 'user-management',
}

interface ITopMenuOption {
	label: ParseKeys
	value: ETopMenuKeys
	route: string
	icon?: React.ReactNode
}

const TopMenuOptions: ITopMenuOption[] = [
	{
		label: 'admin.menu_apps',
		icon: <AppstoreOutlined />,
		value: ETopMenuKeys.AppManagement,
		route: '/app-management',
	},
	{
		label: 'admin.menu_users',
		icon: <UserOutlined />,
		value: ETopMenuKeys.UserManagement,
		route: '/user-management',
	},
]

export default function AdminHeaderTitle() {
	const { t } = useTranslation()
	const [activeKey, setActiveKey] = useState<ETopMenuKeys>()
	const { data: session } = useSession()
	const navigate = useRouter()
	const pathname = usePathname()

	useEffect(() => {
		const key = TopMenuOptions.find(item => item.route === pathname)?.value
		if (key) {
			setActiveKey(key)
		}
	}, [pathname])

	const handleLogout = async () => {
		await signOut({ redirect: false })
		navigate.push('/login')
	}

	const menuItems = [
		{
			key: 'logout',
			icon: <LogoutOutlined />,
			label: t('auth.logout'),
			onClick: handleLogout,
		},
	]

	return (
		<Space>
			<Segmented
				value={activeKey}
				size="large"
				shape="round"
				options={TopMenuOptions.map(item => ({ ...item, label: t(item.label) }))}
				onChange={key => {
					const route = TopMenuOptions.find(item => item.value === key)?.route
					if (route) {
						navigate.push(route)
					} else {
						message.error(t('admin.route_not_found'))
					}
				}}
			/>
			{session?.user && (
				<Dropdown
					menu={{ items: menuItems }}
					placement="bottomRight"
				>
					<Button
						type="text"
						icon={<UserOutlined />}
					>
						{session.user.name || session.user.email}
					</Button>
				</Dropdown>
			)}
		</Space>
	)
}
