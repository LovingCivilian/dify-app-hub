'use client'

import { Conversations, type ConversationsProps } from '@ant-design/x'
import { Avatar, Flex, Typography } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import type { ConversationGroup, ConversationItem } from '../provider/conversations'
import styles from './chat-view.module.css'

export interface ConversationSidebarProps {
	items: ConversationItem[]
	activeKey: string
	onActiveChange: (key: string) => void
	onCreate: () => void
	/** An unsent new chat already exists (spec §4.4: at most one). */
	createDisabled: boolean
	menu?: ConversationsProps['menu']
}

/** The app's icon, name and description (site settings first, the app record second). */
export function AppInfoBlock() {
	const { app, site } = useAppContext()
	const name = site.title || app.info.name
	const description = site.description || app.info.description
	// The padding sits on a wrapper: antd's Flex resets its own padding (flex style: `padding: 0`).
	return (
		<div className={styles.appInfo}>
			<Flex
				gap="small"
				align="center"
			>
				<Avatar
					shape="square"
					src={site.icon_type === 'image' ? site.icon_url || site.icon : undefined}
				>
					{site.icon_type === 'emoji' ? site.icon : name.slice(0, 1)}
				</Avatar>
				<Flex
					vertical
					className={styles.appInfoText}
				>
					<Typography.Text
						strong
						ellipsis
					>
						{name}
					</Typography.Text>
					{description && (
						<Typography.Text
							type="secondary"
							ellipsis
							title={description}
						>
							{description}
						</Typography.Text>
					)}
				</Flex>
			</Flex>
		</div>
	)
}

/** App info and the X Conversations list, grouped by date, with the new-chat button (spec §5.2). */
export default function ConversationSidebar({
	items,
	activeKey,
	onActiveChange,
	onCreate,
	createDisabled,
	menu,
}: ConversationSidebarProps) {
	const { t } = useTranslation()
	const listItems = useMemo(
		() => items.map(item => ({ key: item.key, label: item.label, group: item.group })),
		[items],
	)
	const groupable = useMemo<ConversationsProps['groupable']>(
		() => ({ label: group => t(`chat.group_${group as ConversationGroup}`) }),
		[t],
	)
	return (
		<div className={styles.siderInner}>
			<AppInfoBlock />
			<div className={styles.siderList}>
				<Conversations
					items={listItems}
					activeKey={activeKey}
					onActiveChange={onActiveChange}
					groupable={groupable}
					creation={{ label: t('chat.new_chat'), disabled: createDisabled, onClick: onCreate }}
					menu={menu}
				/>
			</div>
		</div>
	)
}
