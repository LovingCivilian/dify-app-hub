'use client'

import { MenuOutlined, PlusCircleOutlined } from '@ant-design/icons'
import { Button, Flex, Popover } from 'antd'
import { useTranslation } from 'react-i18next'

import styles from './chat-view.module.css'
import { AppAvatar } from './conversation-sidebar'

export interface SiderCollapsedProps {
	onCreate: () => void
	/** An unsent new chat already exists (spec §4.4: at most one). */
	createDisabled: boolean
	/** The conversation list (X Conversations), shown in the popover. */
	list: React.ReactNode
	/** The sider's collapse toggle, which stays reachable in the rail. */
	toggle: React.ReactNode
	/** The popover is controlled so that picking a conversation, which the list reports to the page, closes it. */
	listOpen: boolean
	onListOpenChange: (open: boolean) => void
}

/** What the collapsed sider keeps (spec §5.1): the app icon, the toggle, a new-chat button and the list in a popover. */
export default function SiderCollapsed({
	onCreate,
	createDisabled,
	list,
	toggle,
	listOpen,
	onListOpenChange,
}: SiderCollapsedProps) {
	const { t } = useTranslation()
	return (
		// The padding sits on a wrapper: antd's Flex resets its own padding.
		<div className={styles.rail}>
			<Flex
				vertical
				align="center"
				gap="small"
			>
				<AppAvatar />
				{toggle}
				<Button
					type="text"
					icon={<PlusCircleOutlined />}
					aria-label={t('chat.new_chat')}
					title={t('chat.new_chat')}
					disabled={createDisabled}
					onClick={onCreate}
				/>
				{/* Click-triggered like the header's dropdowns (ADR-0014). */}
				<Popover
					trigger="click"
					placement="rightTop"
					open={listOpen}
					onOpenChange={onListOpenChange}
					// A closed popover costs nothing: its list is rebuilt when it opens.
					destroyOnHidden
					title={t('chat.chat_list')}
					content={<div className={styles.popoverList}>{list}</div>}
				>
					<Button
						type="text"
						icon={<MenuOutlined />}
						aria-label={t('chat.chat_list')}
						title={t('chat.chat_list')}
					/>
				</Popover>
			</Flex>
		</div>
	)
}
