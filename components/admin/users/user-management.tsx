'use client'

import { DeleteOutlined, EditOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons'
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
	Typography,
	theme,
} from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import AdminPageHeader from '@/components/admin/admin-page-header'
import ClientDateTime from '@/components/admin/client-date-time'
import SearchInput from '@/components/shell/search-input'
import { matchesQuery } from '@/lib/match-query'

import { userErrorKey } from './user-errors'
import UserFormDrawer from './user-form-drawer'
import type { UserRow } from './user-row'

/** The user table (spec §6). The "Active" tag is kept as it was (owner decision); dates format in the browser. */
export default function UserManagement({
	users,
	currentUserId,
}: {
	users: UserRow[]
	currentUserId: string
}) {
	const { t } = useTranslation()
	const { token } = theme.useToken()
	const { message } = App.useApp()
	const router = useRouter()
	const [query, setQuery] = useState('')
	// The drawer's `open` follows the admin's action alone; the user it edits stays until its close animation has
	// ended (antd Drawer `afterOpenChange(false)`), so the title and fields do not change while it slides out. Each
	// opening sets it again: the callback does not run when the drawer is closed before its open motion has ended
	// (antd then removes it at once) or reopened while it slides out.
	const [drawerOpen, setDrawerOpen] = useState(false)
	const [editing, setEditing] = useState<UserRow>()
	const openDrawer = (user?: UserRow) => {
		setEditing(user)
		setDrawerOpen(true)
	}
	const shown = users.filter(user => matchesQuery([user.name, user.email], query))

	const remove = async (user: UserRow) => {
		try {
			const response = await fetch(`/api/users/${user.id}`, { method: 'DELETE' })
			if (!response.ok) {
				message.error(t(userErrorKey(response.status, 'delete')))
				return
			}
			message.success(t('admin_users.delete_success'))
			router.refresh()
		} catch (error) {
			console.error('Failed to delete the user', error)
			message.error(t('admin_users.delete_error'))
		}
	}

	const columns: TableProps<UserRow>['columns'] = [
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
			title: t('common.status'),
			key: 'status',
			render: () => <Tag color="green">{t('admin_users.status_active')}</Tag>,
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
					<Button
						type="text"
						icon={<EditOutlined />}
						onClick={() => openDrawer(user)}
					>
						{t('common.edit')}
					</Button>
					{user.id !== currentUserId && (
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
			<AdminPageHeader
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
				pagination={{
					showSizeChanger: true,
					showQuickJumper: true,
					showTotal: total => t('admin_users.total', { total }),
				}}
			/>
			<UserFormDrawer
				open={drawerOpen}
				user={editing}
				onClose={() => setDrawerOpen(false)}
				onClosed={() => setEditing(undefined)}
			/>
		</Flex>
	)
}
