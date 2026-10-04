'use client'

import { AppstoreOutlined, TeamOutlined } from '@ant-design/icons'
import { Layout, theme } from 'antd'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from 'react-i18next'

import AppHeader from './app-header'
import styles from './shell.module.css'

const ADMIN_NAV = [
	{ key: '/app-management', icon: <AppstoreOutlined />, label: 'admin.menu_apps' },
	{ key: '/user-management', icon: <TeamOutlined />, label: 'admin.menu_users' },
] as const

export default function AdminShell({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const pathname = usePathname()
	const { token } = theme.useToken()
	const nav = ADMIN_NAV.map(item => ({
		key: item.key,
		icon: item.icon,
		label: <Link href={item.key}>{t(item.label)}</Link>,
	}))
	const selected = ADMIN_NAV.find(item => pathname.startsWith(item.key))?.key

	return (
		<Layout className={styles.root}>
			<AppHeader
				nav={nav}
				navSelectedKey={selected}
			/>
			<Layout.Content
				className={styles.content}
				style={{ padding: token.paddingLG }}
			>
				{children}
			</Layout.Content>
		</Layout>
	)
}
