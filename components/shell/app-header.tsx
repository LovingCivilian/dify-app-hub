'use client'

import { GithubOutlined, MenuOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { Button, Drawer, Flex, Layout, Menu, Space, Typography, theme } from 'antd'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import LogoIcon from '@/assets/images/logo.png'

import AccountDropdown from './account-dropdown'
import styles from './app-header.module.css'
import LanguageDropdown from './language-dropdown'
import ThemeDropdown from './theme-dropdown'

export interface AppHeaderProps {
	/** Area navigation (admin). A horizontal Menu from md up, inside a Drawer below. */
	nav?: MenuProps['items']
	navSelectedKey?: string
	/** Centre content (chat: the app title); the centre region is rendered only when this is set. */
	title?: React.ReactNode
	/** Controls placed before the standard dropdowns (chat: the width toggle). */
	extra?: React.ReactNode
	/** Below md this replaces the standard dropdowns (chat: the conversation drawer trigger). */
	mobileMenu?: React.ReactNode
}

const GITHUB_URL = 'https://github.com/lexmin0412/dify-app-hub'

// ADR-0014: click-triggered, i18n-named header controls — docs/decisions/0014-header-controls-click-triggered-named-through-i18next.md
// Breakpoint variants are both rendered and switched by CSS (spec 2026-10-04 chat §3.3): Grid.useBreakpoint()
// returns {} on the server, so a hook-chosen branch would paint the mobile header on desktop first.
export default function AppHeader({
	nav,
	navSelectedKey,
	title,
	extra,
	mobileMenu,
}: AppHeaderProps) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const [navOpen, setNavOpen] = useState(false)
	const selectedKeys = navSelectedKey ? [navSelectedKey] : []

	const dropdowns = (
		<Space size={token.marginXXS}>
			<LanguageDropdown />
			<ThemeDropdown />
			<Button
				type="text"
				icon={<GithubOutlined />}
				href={GITHUB_URL}
				target="_blank"
				rel="noreferrer"
				aria-label="GitHub"
				title="GitHub"
			/>
			<AccountDropdown />
		</Space>
	)

	return (
		<Layout.Header
			className={styles.header}
			style={{
				background: token.colorBgContainer,
				borderBottom: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
				paddingInline: token.paddingLG,
			}}
		>
			<Flex
				align="center"
				gap={token.marginSM}
				className={styles.side}
			>
				{nav && (
					<span className={styles.mobileOnly}>
						<Button
							type="text"
							icon={<MenuOutlined />}
							aria-label={t('system.menu')}
							title={t('system.menu')}
							onClick={() => setNavOpen(true)}
						/>
					</span>
				)}
				<Link
					href="/apps"
					className={styles.logo}
					aria-label="Dify App Hub"
				>
					<Image
						src={LogoIcon}
						width={28}
						loading="eager"
						alt=""
					/>
					<Typography.Text
						strong
						className={styles.title}
					>
						Dify App Hub
					</Typography.Text>
				</Link>
				{nav && (
					<span className={styles.desktopOnly}>
						<Menu
							mode="horizontal"
							items={nav}
							selectedKeys={selectedKeys}
							className={styles.nav}
							style={{ borderBottom: 0 }}
						/>
					</span>
				)}
			</Flex>
			{title && <div className={styles.center}>{title}</div>}
			<Flex
				align="center"
				justify="flex-end"
				gap={token.marginSM}
				className={styles.side}
			>
				{extra}
				{mobileMenu ? (
					<>
						<span className={styles.desktopOnly}>{dropdowns}</span>
						<span className={styles.mobileOnly}>{mobileMenu}</span>
					</>
				) : (
					dropdowns
				)}
			</Flex>
			{nav && (
				<Drawer
					open={navOpen}
					onClose={() => setNavOpen(false)}
					placement="left"
					title={t('system.menu')}
				>
					<Menu
						mode="inline"
						items={nav}
						selectedKeys={selectedKeys}
						onClick={() => setNavOpen(false)}
						style={{ borderInlineEnd: 0 }}
					/>
				</Drawer>
			)}
		</Layout.Header>
	)
}
