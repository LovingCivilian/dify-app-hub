'use client'

import { Conversations, type ConversationsProps } from '@ant-design/x'
import { Avatar, Flex, Typography } from 'antd'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppContext } from '../app-context'
import type { ConversationGroup, ConversationItem } from '../provider/conversations'
import styles from './chat-view.module.css'

export interface ListCreation {
	onClick: () => void
	/** An unsent new chat already exists (spec §4.4: at most one). */
	disabled: boolean
}

export interface ConversationListProps {
	items: ConversationItem[]
	activeKey: string
	onActiveChange: (key: string) => void
	/** The list's new-chat button; without it the list has none (the collapsed sider has its own). */
	creation?: ListCreation
	menu?: ConversationsProps['menu']
}

export interface ConversationSidebarProps extends Omit<ConversationListProps, 'creation'> {
	onCreate: () => void
	/** An unsent new chat already exists (spec §4.4: at most one). */
	createDisabled: boolean
	/** At the end of the app info row (the sider's collapse toggle). */
	action?: React.ReactNode
}

/** The app's icon: the site's image or emoji, else the first letter of its name. */
export function AppAvatar() {
	const { app, site } = useAppContext()
	const name = site.title || app.info.name
	return (
		<Avatar
			shape="square"
			src={site.icon_type === 'image' ? site.icon_url || site.icon : undefined}
		>
			{site.icon_type === 'emoji' ? site.icon : name.slice(0, 1)}
		</Avatar>
	)
}

/** The app's icon, name and description (site settings first, the app record second), then `action`. */
export function AppInfoBlock({ action }: { action?: React.ReactNode }) {
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
				<AppAvatar />
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
				{action}
			</Flex>
		</div>
	)
}

/** The X Conversations list, grouped by date, with the item menu (spec §5.2). */
export const ConversationList = memo(function ConversationList({
	items,
	activeKey,
	onActiveChange,
	creation,
	menu,
}: ConversationListProps) {
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
		<Conversations
			items={listItems}
			activeKey={activeKey}
			onActiveChange={onActiveChange}
			groupable={groupable}
			creation={
				creation && {
					label: t('chat.new_chat'),
					disabled: creation.disabled,
					onClick: creation.onClick,
				}
			}
			menu={menu}
		/>
	)
})

/**
 * App info (with the optional `action` at its end) and the list with the new-chat button, for the sider
 * and the mobile drawer. Memoised: the page re-renders on every streamed chunk and the list holds a dropdown per item.
 */
const ConversationSidebar = memo(function ConversationSidebar({
	items,
	activeKey,
	onActiveChange,
	onCreate,
	createDisabled,
	menu,
	action,
}: ConversationSidebarProps) {
	const creation = useMemo(
		() => ({ onClick: onCreate, disabled: createDisabled }),
		[createDisabled, onCreate],
	)
	return (
		<div className={styles.siderInner}>
			<AppInfoBlock action={action} />
			<div className={styles.siderList}>
				<ConversationList
					items={items}
					activeKey={activeKey}
					onActiveChange={onActiveChange}
					creation={creation}
					menu={menu}
				/>
			</div>
		</div>
	)
})

export default ConversationSidebar
