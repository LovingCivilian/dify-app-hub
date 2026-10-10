'use client'

import { Conversations, type ConversationsProps } from '@ant-design/x'
import { Avatar, Flex, Typography, type AvatarProps } from 'antd'
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
	/**
	 * A send waits for the active conversation's history (useDifyChat `queued`): the other conversations and
	 * the item menus are off until its reply starts, and the list says why. The caller disables `creation`.
	 */
	locked?: boolean
}

export interface ConversationSidebarProps extends Omit<ConversationListProps, 'creation'> {
	onCreate: () => void
	/** An unsent new chat already exists (spec §4.4: at most one). */
	createDisabled: boolean
}

/**
 * The app's icon: the stored Dify icon (an emoji, or the image through the icon route, so the Dify host never
 * reaches the browser; charter §4.1, §4.4), else the first letter of its name (also while the image loads or fails).
 */
export function AppAvatar({ size, alt }: Pick<AvatarProps, 'size' | 'alt'>) {
	const { app, site } = useAppContext()
	const name = site.title || app.name
	const icon = app.icon
	return (
		<Avatar
			size={size}
			alt={alt ?? name}
			shape="square"
			src={icon?.kind === 'image' ? `/api/apps/${encodeURIComponent(app.id)}/icon` : undefined}
			style={
				icon?.kind === 'emoji' && icon.background ? { backgroundColor: icon.background } : undefined
			}
		>
			{icon?.kind === 'emoji' ? icon.emoji : name.slice(0, 1)}
		</Avatar>
	)
}

/** The app's icon, name and description (site settings first, the app record second). */
export function AppInfoBlock() {
	const { app, site } = useAppContext()
	const name = site.title || app.name
	const description = site.description || app.description
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
	locked = false,
}: ConversationListProps) {
	const { t } = useTranslation()
	// X `ConversationItemType.disabled`: the item ignores clicks and shows no menu. The active one stays
	// enabled, since X drops the active style of a disabled item.
	const listItems = useMemo(
		() =>
			items.map(item => ({
				key: item.key,
				label: item.label,
				group: item.group,
				disabled: locked && item.key !== activeKey,
			})),
		[activeKey, items, locked],
	)
	const groupable = useMemo<ConversationsProps['groupable']>(
		() => ({ label: group => t(`chat.group_${group as ConversationGroup}`) }),
		[t],
	)
	return (
		<>
			{locked && (
				<div className={styles.queuedHint}>
					<Typography.Text type="secondary">{t('chat.sending_queued')}</Typography.Text>
				</div>
			)}
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
				// The active row's menu could delete it, which would switch conversation.
				menu={locked ? undefined : menu}
			/>
		</>
	)
})

/**
 * App info and the list with the new-chat button, for the sider and the mobile drawer. Memoised: the page
 * re-renders on every streamed chunk and the list holds a dropdown per item.
 */
const ConversationSidebar = memo(function ConversationSidebar({
	items,
	activeKey,
	onActiveChange,
	onCreate,
	createDisabled,
	menu,
	locked,
}: ConversationSidebarProps) {
	const creation = useMemo(
		() => ({ onClick: onCreate, disabled: createDisabled }),
		[createDisabled, onCreate],
	)
	return (
		<div className={styles.siderInner}>
			<AppInfoBlock />
			<div className={styles.siderList}>
				<ConversationList
					items={items}
					activeKey={activeKey}
					onActiveChange={onActiveChange}
					creation={creation}
					menu={menu}
					locked={locked}
				/>
			</div>
		</div>
	)
})

export default ConversationSidebar
