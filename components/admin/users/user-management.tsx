'use client'

import {
	CheckCircleOutlined,
	DeleteOutlined,
	EditOutlined,
	PlusOutlined,
	StopOutlined,
	UserOutlined,
} from '@ant-design/icons'
import {
	App,
	Avatar,
	Button,
	Col,
	Empty,
	Flex,
	Popconfirm,
	Row,
	Space,
	Table,
	type TableProps,
	Tag,
	Tooltip,
	Typography,
	theme,
} from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
	deactivateUserAction,
	deleteUserAction,
	reactivateUserAction,
} from '@/app/(admin)/user-management/actions'
import { tablePagination } from '@/components/admin/table-pagination'
import PageHeader from '@/components/shell/page-header'
import ClientDateTime from '@/components/admin/client-date-time'
import SearchInput from '@/components/shell/search-input'
import { useActionTransition } from '@/hooks/use-action-transition'
import { canManage, type Role } from '@/lib/auth/roles'
import type { UserDto } from '@/lib/data/users'
import { matchesQuery } from '@/lib/match-query'

import { ROLE_LABEL_KEYS } from './role-labels'
import styles from './user-management.module.css'
import { userErrorKey } from './user-errors'
import UserFormDrawer from './user-form-drawer'

/** The user table (charter §4.2): the role column, Server Actions for every write; the status column shows Active or Deactivated (ADR-0027) instead of the fixed tag; dates format in the browser. */
export default function UserManagement({
	users,
	currentUser,
}: {
	users: UserDto[]
	currentUser: { id: string; role: Role }
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const [query, setQuery] = useState('')
	// The drawer's `open` follows the admin's action alone; the user it edits stays until its close animation has
	// ended (antd Drawer `afterOpenChange(false)`), so the title and fields do not change while it slides out. Each
	// opening sets it again: the callback does not run when the drawer is closed before its open motion has ended
	// (antd then removes it at once) or reopened while it slides out.
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [editing, setEditing] = useState<UserDto>()
	const openDrawer = (user?: UserDto) => {
		setEditing(user)
		setDrawerOpen(true)
	}
	// The id too (ADR-0026): an id copied from Dify's logs or Langfuse finds its account.
	const shown = users.filter(user => matchesQuery([user.name, user.email, user.id], query))
	// Who deactivated an account, by name or email; null when that account no longer exists.
	const nameOf = (id: string | null) => {
		const found = users.find(user => user.id === id)
		return found ? found.name || found.email : null
	}

	const { run } = useActionTransition()
	const remove = (user: UserDto) =>
		run(async () => {
			const result = await deleteUserAction(user.id)
			if (result.ok) message.success(t('admin_users.delete_success'))
			else message.error(t(userErrorKey(result.code)))
		})
	const setActive = (user: UserDto, active: boolean) =>
		run(async () => {
			const result = active
				? await reactivateUserAction(user.id)
				: await deactivateUserAction(user.id)
			if (result.ok)
				message.success(
					t(active ? 'admin_users.reactivate_success' : 'admin_users.deactivate_success'),
				)
			else message.error(t(userErrorKey(result.code)))
		})

	const columns: TableProps<UserDto>['columns'] = [
		{
			title: t('admin_users.column_user'),
			key: 'user',
			render: (_, user) => (
				<Space>
					<Avatar icon={<UserOutlined />} />
					<div>
						<div>{user.name || t('admin_users.name_not_set')}</div>
						<Typography.Text type="secondary">{user.email}</Typography.Text>
					</div>
				</Space>
			),
		},
		{
			// ADR-0026: the account id is the Dify end user; the owner copies it into Dify's log search or Langfuse.
			title: t('admin_users.dify_user_id'),
			key: 'difyUserId',
			render: (_, user) => (
				<Typography.Text
					className={styles.difyUserId}
					// The tooltips from i18next: antd's ar_EG pack calls "Copied" نقل ("moved").
					copyable={{ text: user.id, tooltips: [t('common.copy'), t('common.copied')] }}
					ellipsis={{ tooltip: user.id }}
				>
					{user.id}
				</Typography.Text>
			),
		},
		{
			title: t('admin_users.role'),
			key: 'role',
			render: (_, user) => (
				<Tag color={user.role === 'owner' ? 'purple' : user.role === 'admin' ? 'gold' : 'default'}>
					{t(ROLE_LABEL_KEYS[user.role])}
				</Tag>
			),
		},
		{
			title: t('admin_users.column_groups'),
			key: 'groups',
			render: (_, user) =>
				user.groups.length ? (
					<Flex
						wrap
						gap="small"
					>
						{user.groups.map(group => (
							<Tag key={group.id}>{group.name}</Tag>
						))}
					</Flex>
				) : null,
		},
		{
			title: t('common.status'),
			key: 'status',
			render: (_, user) => {
				if (user.active) return <Tag color="green">{t('admin_users.status_active')}</Tag>
				const deactivation = user.adminDeactivation
				if (!deactivation) return <Tag color="red">{t('admin_users.status_deactivated')}</Tag>
				const by = nameOf(deactivation.by)
				// Who and when are in the tooltip only, so it opens on keyboard focus too: the tag takes focus and the
				// trigger includes `focus` (antd Tooltip FAQ, "How to support keyboard accessibility?"; WAI-ARIA APG,
				// "Tooltip Pattern"); antd describes the tag by the open tooltip (`aria-describedby`).
				return (
					<Tooltip
						trigger={['hover', 'focus']}
						title={
							<>
								<div>
									{by
										? t('admin_users.deactivated_by', { name: by })
										: t('admin_users.deactivated_by_unknown')}
								</div>
								<ClientDateTime value={deactivation.at} />
							</>
						}
					>
						<Tag
							color="red"
							tabIndex={0}
						>
							{t('admin_users.status_deactivated')}
						</Tag>
					</Tooltip>
				)
			},
		},
		{
			title: t('common.created_at'),
			key: 'createdAt',
			render: (_, user) => <ClientDateTime value={user.createdAt} />,
		},
		{
			title: t('admin_users.column_updated_at'),
			key: 'updatedAt',
			render: (_, user) => <ClientDateTime value={user.updatedAt} />,
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_, user) => (
				<Space>
					{(user.id === currentUser.id || canManage(currentUser.role, user.role)) && (
						<Button
							type="text"
							icon={<EditOutlined />}
							onClick={() => openDrawer(user)}
						>
							{t('common.edit')}
						</Button>
					)}
					{canManage(currentUser.role, user.role) && user.active && (
						<Popconfirm
							title={t('admin_users.deactivate_confirm_title')}
							description={t('admin_users.deactivate_confirm_description')}
							okText={t('admin_users.deactivate')}
							okButtonProps={{ danger: true }}
							cancelText={t('common.cancel')}
							onConfirm={() => setActive(user, false)}
						>
							<Button
								type="text"
								danger
								icon={<StopOutlined />}
							>
								{t('admin_users.deactivate')}
							</Button>
						</Popconfirm>
					)}
					{canManage(currentUser.role, user.role) && user.adminDeactivation && (
						<Popconfirm
							title={t('admin_users.reactivate_confirm_title')}
							description={t('admin_users.reactivate_confirm_description')}
							okText={t('admin_users.reactivate')}
							cancelText={t('common.cancel')}
							onConfirm={() => setActive(user, true)}
						>
							<Button
								type="text"
								icon={<CheckCircleOutlined />}
							>
								{t('admin_users.reactivate')}
							</Button>
						</Popconfirm>
					)}
					{canManage(currentUser.role, user.role) && (
						<Popconfirm
							title={t('admin_users.delete_confirm_title')}
							description={t('admin_users.delete_confirm_description')}
							okText={t('common.delete')}
							okButtonProps={{ danger: true }}
							cancelText={t('common.cancel')}
							onConfirm={() => remove(user)}
						>
							<Button
								type="text"
								danger
								icon={<DeleteOutlined />}
							>
								{t('common.delete')}
							</Button>
						</Popconfirm>
					)}
				</Space>
			),
		},
	]

	return (
		<Flex
			vertical
			gap={token.margin}
		>
			<PageHeader
				title={t('admin.menu_users')}
				subtitle={t('admin_users.subtitle')}
				action={
					<Button
						type="primary"
						icon={<PlusOutlined />}
						onClick={() => openDrawer()}
					>
						{t('admin_users.add_user')}
					</Button>
				}
			/>
			<Row>
				<Col
					xs={24}
					md={12}
					lg={8}
				>
					<SearchInput
						placeholder={t('admin_users.search_placeholder')}
						value={query}
						onChange={setQuery}
					/>
				</Col>
			</Row>
			<Table
				rowKey="id"
				columns={columns}
				dataSource={shown}
				scroll={{ x: 'max-content' }}
				locale={
					query.trim()
						? {
								emptyText: (
									<Empty
										image={Empty.PRESENTED_IMAGE_SIMPLE}
										description={t('admin_users.no_match')}
									/>
								),
							}
						: undefined
				}
				pagination={tablePagination(total => t('admin_users.total', { total }))}
			/>
			<UserFormDrawer
				open={drawerOpen}
				user={editing}
				currentUser={currentUser}
				onClose={() => setDrawerOpen(false)}
				onClosed={() => setEditing(undefined)}
			/>
		</Flex>
	)
}
