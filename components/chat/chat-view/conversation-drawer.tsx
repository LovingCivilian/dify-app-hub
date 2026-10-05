'use client'

import { Drawer, Flex, Grid } from 'antd'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import AccountDropdown from '@/components/shell/account-dropdown'
import LanguageDropdown from '@/components/shell/language-dropdown'
import ThemeDropdown from '@/components/shell/theme-dropdown'

/**
 * Below md the conversation list lives here; antd mounts the content on the first open. The footer holds
 * the controls the header hides below md (its own copies are `display: none` there, so each name exists
 * once for assistive technology), reusing the shell's click-triggered dropdowns (ADR-0014).
 */
export default function ConversationDrawer({
	open,
	onClose,
	children,
}: {
	open: boolean
	onClose: () => void
	children: React.ReactNode
}) {
	const { t } = useTranslation()
	// The sider takes over from md up and the trigger is hidden there: an open drawer would cover the page
	// with nothing to close it but the mask. `Grid.useBreakpoint` is read after hydration only (it is `{}`
	// on the server), which suits behaviour; the markup itself is switched by CSS.
	const screens = Grid.useBreakpoint()
	useEffect(() => {
		if (open && screens.md) onClose()
	}, [open, screens.md, onClose])
	return (
		<Drawer
			open={open}
			onClose={onClose}
			placement="left"
			title={t('chat.conversations_menu')}
			styles={{ body: { padding: 0 } }}
			footer={
				<Flex
					gap="small"
					justify="flex-end"
				>
					<LanguageDropdown />
					<ThemeDropdown />
					<AccountDropdown />
				</Flex>
			}
		>
			{children}
		</Drawer>
	)
}
