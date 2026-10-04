'use client'

import { GithubOutlined, MenuOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { Button, Drawer, Flex, Grid, Layout, Menu, Space, Typography, theme } from 'antd'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

import LogoIcon from '@/assets/images/logo.png'

import AccountDropdown from './account-dropdown'
import styles from './app-header.module.css'
import LanguageDropdown from './language-dropdown'
import ThemeDropdown from './theme-dropdown'

export interface AppHeaderProps {
	/** Area navigation (admin). A horizontal Menu on desktop, inside a Drawer on mobile. */
	nav?: MenuProps['items']
	navSelectedKey?: string
	/** Centre content (chat: the app title). */
	title?: React.ReactNode
	/** Controls placed before the standard dropdowns (chat: the width toggle). */
	extra?: React.ReactNode
	/** Mobile-only trigger that replaces the standard dropdowns (chat: the conversation menu). */
	mobileMenu?: React.ReactNode
}

const GITHUB_URL = 'https://github.com/lexmin0412/dify-app-hub'

export default function AppHeader({
	nav,
	navSelectedKey,
	title,
	extra,
	mobileMenu,
}: AppHeaderProps) {
	const { token } = theme.useToken()
	const screens = Grid.useBreakpoint()
	const isMobile = !screens.md
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
				{isMobile && nav && (
					<Button
						type="text"
						icon={<MenuOutlined />}
						aria-label="Menu"
						onClick={() => setNavOpen(true)}
					/>
				)}
				<Link
					href="/apps"
					className={styles.logo}
				>
					<Image
						src={LogoIcon}
						width={28}
						height={28}
						alt=""
					/>
					<Typography.Text
						strong
						className={styles.title}
					>
						Dify App Hub
					</Typography.Text>
				</Link>
				{!isMobile && nav && (
					<Menu
						mode="horizontal"
						items={nav}
						selectedKeys={selectedKeys}
						className={styles.nav}
					/>
				)}
			</Flex>
			<div className={styles.center}>{title}</div>
			<Flex
				align="center"
				justify="flex-end"
				gap={token.marginSM}
				className={styles.side}
			>
				{extra}
				{isMobile && mobileMenu ? mobileMenu : dropdowns}
			</Flex>
			{nav && (
				<Drawer
					open={navOpen}
					onClose={() => setNavOpen(false)}
					placement="left"
				>
					<Menu
						mode="inline"
						items={nav}
						selectedKeys={selectedKeys}
						onClick={() => setNavOpen(false)}
					/>
				</Drawer>
			)}
		</Layout.Header>
	)
}
