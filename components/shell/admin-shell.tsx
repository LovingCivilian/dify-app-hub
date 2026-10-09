'use client'

import { AppstoreOutlined, TeamOutlined } from '@ant-design/icons'
import { Layout, Menu } from 'antd'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AppHeader from './app-header'
import AppSider from './app-sider'
import styles from './shell.module.css'

const ADMIN_NAV = [
	{ key: '/app-management', icon: <AppstoreOutlined />, label: 'admin.menu_apps' },
	{ key: '/user-management', icon: <TeamOutlined />, label: 'admin.menu_users' },
] as const

/** Shell for the admin area: the shared header, then the sidebar with the area's navigation beside the content region. */
export default function AdminShell({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const pathname = usePathname()
	// Kept while the admin pages change (the (admin) layout stays mounted), not across loads (ProLayout's default).
	const [collapsed, setCollapsed] = useState(false)
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
			<Layout hasSider>
				<AppSider
					collapsed={collapsed}
					onCollapse={setCollapsed}
				>
					{/* An inline Menu inside a collapsed Sider collapses with it to its icons (antd reads the Sider's state). */}
					<div className={styles.siderMenu}>
						<Menu
							mode="inline"
							items={nav}
							selectedKeys={selected ? [selected] : []}
							// The sider draws the edge line (antd Layout, demo "Header Sider 2").
							style={{ borderInlineEnd: 0 }}
						/>
					</div>
				</AppSider>
				<Layout.Content className={`${styles.content} ${styles.adminContent}`}>
					{children}
				</Layout.Content>
			</Layout>
		</Layout>
	)
}
