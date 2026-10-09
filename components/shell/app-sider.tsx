'use client'

import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import { Button, Layout, theme } from 'antd'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import styles from './app-sider.module.css'

/** The one literal width in the shells (X's full-page pattern gives its sider a literal width too). */
const SIDER_WIDTH = 280

export interface AppSiderProps {
	collapsed: boolean
	onCollapse: (collapsed: boolean) => void
	children: React.ReactNode
}

/**
 * The hub's sidebar, shared by the chat (conversations) and the admin area (navigation) so the two cannot drift:
 * antd's collapsible `Layout.Sider` with its trigger bar at the bottom (antd Layout, demo "Sider"), controlled by
 * the caller, from md up (below md the header's drawer replaces it, CSS in app-sider.module.css). No `breakpoint`:
 * it measures after hydration, so the server would paint the expanded sider on phones.
 */
export default function AppSider({ collapsed, onCollapse, children }: AppSiderProps) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const id = useId()
	const label = collapsed ? t('system.sidebar_open') : t('system.sidebar_close')
	return (
		<Layout.Sider
			id={id}
			width={SIDER_WIDTH}
			theme="light"
			className={styles.sider}
			collapsible
			collapsed={collapsed}
			onCollapse={onCollapse}
			collapsedWidth={token.controlHeightLG * 2}
			// antd's trigger bar is a div with a click handler around an arrow: no role, no name, no keyboard. The
			// `trigger` node keeps the bar and its arrows and adds a button for them, a disclosure of the sider
			// (WAI-ARIA: aria-expanded, aria-controls). The button has no handler of its own: its click, from a
			// pointer or from Enter and Space, bubbles to the bar's, which calls onCollapse. antd flips the arrows
			// under `direction="rtl"`; these follow when RTL lands (ADR-0005).
			trigger={
				<div className={styles.trigger}>
					<Button
						type="text"
						icon={collapsed ? <RightOutlined /> : <LeftOutlined />}
						aria-label={label}
						title={label}
						aria-expanded={!collapsed}
						aria-controls={id}
					/>
				</div>
			}
		>
			{children}
		</Layout.Sider>
	)
}
