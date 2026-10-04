'use client'

import { Drawer } from 'antd'
import { useTranslation } from 'react-i18next'

/** Below md the conversation list lives here; antd mounts the content on the first open. */
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
	return (
		<Drawer
			open={open}
			onClose={onClose}
			placement="left"
			title={t('chat.conversations_menu')}
			styles={{ body: { padding: 0 } }}
		>
			{children}
		</Drawer>
	)
}
