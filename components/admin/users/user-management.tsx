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
import { canManage, MANAGEABLE_ROLES, type Role } from '@/lib/auth/roles'
import type { UserDto } from '@/lib/data/users'
import type { DirectoryStatusDto } from '@/lib/directory/admin'
import { matchesQuery } from '@/lib/match-query'

import { ROLE_LABEL_KEYS } from './role-labels'
import styles from './user-management.module.css'
import { userErrorKey } from './user-errors'
import DirectoryStatus from './directory-status'
import UserFormDrawer from './user-form-drawer'

/**
 * The user table (charter §4.2): the role column, Server Actions for every write; the source column tells local and
 * directory accounts apart (ADR-0029); the status column shows Active, or a tag per deactivation marker (ADR-0027);
 * dates format in the browser.
 */
export default function UserManagement({
	users,
	directory,
	currentUser,
}: {
	users: UserDto[]
	directory: DirectoryStatusDto | null
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
	// The id too (ADR-0026): an id copied from Dify's logs or Langfuse finds its account; and a directory login name.
	const shown = users.filter(user =>
		matchesQuery([user.name, user.email, user.id, user.directoryUsername ?? ''], query),
	)
	// Edit is offered only where something can be changed, as every action the rank map denies is left out (ADR-0024).
	// A local account: your own name and email, or an account your rank manages. A directory account offers its role
	// alone (decision an): only an account your rank manages, and only when your rank can give it another role (the
	// owner; an admin gives the user role only). Your own directory row never qualifies: nobody manages their own rank.
	const canEdit = (user: UserDto) =>
		user.source === 'ldap'
			? canManage(currentUser.role, user.role) && MANAGEABLE_ROLES[currentUser.role].length > 1
			: user.id === currentUser.id || canManage(currentUser.role, user.role)
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
			title: t('admin_users.column_source'),
			key: 'source',
			render: (_, user) =>
				user.source === 'ldap' ? (
					<Space
						orientation="vertical"
						size={0}
					>
						<Tag color="blue">{t('admin_users.source_directory')}</Tag>
						{user.directoryUsername && (
							<Typography.Text type="secondary">{user.directoryUsername}</Typography.Text>
						)}
					</Space>
				) : (
					<Tag>{t('admin_users.source_local')}</Tag>
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
				const by = deactivation ? nameOf(deactivation.by) : null
				// Who and when are in the tooltips only, so each opens on keyboard focus too: the tag takes focus and the
				// trigger includes `focus` (antd Tooltip FAQ, "How to support keyboard accessibility?"; WAI-ARIA APG,
				// "Tooltip Pattern"); antd describes the tag by the open tooltip (`aria-describedby`).
				return (
					<Flex
						wrap
						gap="small"
					>
						{deactivation && (
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
						)}
						{user.directoryDeactivation && (
							<Tooltip
								trigger={['hover', 'focus']}
								title={
									<>
										<div>{t('admin_users.not_in_directory_since')}</div>
										<ClientDateTime value={user.directoryDeactivation.at} />
									</>
								}
							>
								<Tag
									color="orange"
									tabIndex={0}
								>
									{t('admin_users.status_not_in_directory')}
								</Tag>
							</Tooltip>
						)}
					</Flex>
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
					{canEdit(user) && (
						<Button
							type="text"
							icon={<EditOutlined />}
							onClick={() => openDrawer(user)}
						>
							{t('common.edit')}
						</Button>
					)}
					{/* Decision ao: offered while the admin marker is empty, so an account the directory has deactivated
					    can be kept off when the directory lists it again (ADR-0027's two markers). */}
					{canManage(currentUser.role, user.role) && !user.adminDeactivation && (
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
							description={t(
								user.source === 'ldap'
									? 'admin_users.delete_directory_confirm_description'
									: 'admin_users.delete_confirm_description',
							)}
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
			{directory && <DirectoryStatus status={directory} />}
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
