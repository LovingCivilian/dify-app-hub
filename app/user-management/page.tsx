'use client'

import { DeleteOutlined, EditOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons'
import { Button, message, Popconfirm, Space, Table, Tag } from 'antd'
import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import UserEditDrawer from './components/user-edit-drawer'

interface User {
	id: string
	name: string | null
	email: string
	createdAt: string
	updatedAt: string
}

export default function UserManagementPage() {
	const { t } = useTranslation()
	const { data: session } = useSession()
	const [users, setUsers] = useState<User[]>([])
	const [loading, setLoading] = useState(false)
	const [drawerVisible, setDrawerVisible] = useState(false)
	const [editingUser, setEditingUser] = useState<User | null>(null)

	const fetchUsers = async () => {
		setLoading(true)
		try {
			const response = await fetch('/api/users')
			if (response.ok) {
				const data = await response.json()
				setUsers(data)
			} else {
				message.error(t('admin_users.fetch_failed'))
			}
		} catch (error) {
			console.error('Error while fetching users', error)
			message.error(t('admin_users.fetch_error'))
		} finally {
			setLoading(false)
		}
	}

	const handleDelete = async (userId: string) => {
		try {
			const response = await fetch(`/api/users/${userId}`, {
				method: 'DELETE',
			})
			if (response.ok) {
				message.success(t('admin_users.delete_success'))
				fetchUsers()
			} else {
				message.error(t('admin_users.delete_failed'))
			}
		} catch (error) {
			console.error('Error while deleting user', error)
			message.error(t('admin_users.delete_error'))
		}
	}

	const handleEdit = (user: User) => {
		setEditingUser(user)
		setDrawerVisible(true)
	}

	const handleAdd = () => {
		setEditingUser(null)
		setDrawerVisible(true)
	}

	const handleDrawerClose = () => {
		setDrawerVisible(false)
		setEditingUser(null)
	}

	const handleSaveSuccess = () => {
		setDrawerVisible(false)
		setEditingUser(null)
		fetchUsers()
	}

	useEffect(() => {
		fetchUsers()
	}, [])

	const columns = [
		{
			title: t('admin_users.column_user'),
			dataIndex: 'name',
			key: 'name',
			render: (name: string | null, record: User) => (
				<Space>
					<UserOutlined />
					<div>
						<div>{name || t('admin_users.name_not_set')}</div>
						<div className="text-sm text-gray-500">{record.email}</div>
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
			dataIndex: 'createdAt',
			key: 'createdAt',
			render: (date: string) => new Date(date).toLocaleString('zh-CN'),
		},
		{
			title: t('admin_users.column_updated_at'),
			dataIndex: 'updatedAt',
			key: 'updatedAt',
			render: (date: string) => new Date(date).toLocaleString('zh-CN'),
		},
		{
			title: t('common.actions'),
			key: 'actions',
			render: (_: unknown, record: User) => (
				<Space>
					<Button
						type="text"
						icon={<EditOutlined />}
						onClick={() => handleEdit(record)}
					>
						{t('common.edit')}
					</Button>
					{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
					{record.id !== (session?.user as any)?.id && (
						<Popconfirm
							title={t('admin_users.delete_confirm_title')}
							description={t('admin_users.delete_confirm_description')}
							onConfirm={() => handleDelete(record.id)}
							okText={t('common.ok')}
							cancelText={t('common.cancel')}
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
		<div className="h-full w-full px-6">
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold">{t('admin.menu_users')}</h1>
					<p className="mt-1 text-gray-600">{t('admin_users.subtitle')}</p>
				</div>
				<Button
					type="primary"
					icon={<PlusOutlined />}
					onClick={handleAdd}
				>
					{t('admin_users.add_user')}
				</Button>
			</div>

			<Table
				columns={columns}
				dataSource={users}
				rowKey="id"
				loading={loading}
				pagination={{
					showSizeChanger: true,
					showQuickJumper: true,
					showTotal: total => t('admin_users.total', { total }),
				}}
			/>

			<UserEditDrawer
				visible={drawerVisible}
				user={editingUser}
				onClose={handleDrawerClose}
				onSaveSuccess={handleSaveSuccess}
			/>
		</div>
	)
}
