'use client'

import { Layout, Menu } from 'antd'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ADMIN_NAV_OPEN_KEYS, adminNavItems, selectedAdminKey } from './admin-nav'
import AppHeader from './app-header'
import AppSider from './app-sider'
import styles from './shell.module.css'

/** Shell for the admin area: the shared header, then the sidebar with the area's navigation beside the content region. */
export default function AdminShell({ children }: { children: React.ReactNode }) {
	const { t } = useTranslation()
	const pathname = usePathname()
	// Kept while the admin pages change (the (admin) layout stays mounted), not across loads (ProLayout's default).
	const [collapsed, setCollapsed] = useState(false)
	const nav = adminNavItems(key => t(key))
	const selected = selectedAdminKey(pathname)

	return (
		<Layout className={styles.root}>
			<AppHeader
				nav={nav}
				navSelectedKey={selected}
				navOpenKeys={ADMIN_NAV_OPEN_KEYS}
			/>
			<Layout hasSider>
				<AppSider
					collapsed={collapsed}
					onCollapse={setCollapsed}
				>
					{/* The area's navigation landmark inside the sider's aside (WHATWG HTML, "The aside element": "groups of
					    nav elements"); the page's only nav, so it needs no label (WAI-ARIA APG, "Landmark Regions"). An
					    inline Menu inside a collapsed Sider collapses with it to its icons (antd reads the Sider's state). */}
					<nav className={styles.siderMenu}>
						<Menu
							mode="inline"
							items={nav}
							selectedKeys={selected ? [selected] : []}
							defaultOpenKeys={ADMIN_NAV_OPEN_KEYS}
							// In the collapsed sider a group opens its pop-out on click, not hover (antd Menu
							// `triggerSubMenuAction`, default hover; ADR-0014's reasons: touch, accidental opening).
							triggerSubMenuAction="click"
							// The sider draws the edge line (antd Layout, demo "Header Sider 2").
							style={{ borderInlineEnd: 0 }}
						/>
					</nav>
				</AppSider>
				<Layout.Content className={`${styles.content} ${styles.adminContent}`}>
					{children}
				</Layout.Content>
			</Layout>
		</Layout>
	)
}
