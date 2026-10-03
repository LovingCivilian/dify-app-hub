'use client'

import { Button, Drawer, Form, Input, message, Space } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface User {
	id: string
	name: string | null
	email: string
	createdAt: string
	updatedAt: string
}

interface UserEditDrawerProps {
	visible: boolean
	user: User | null
	onClose: () => void
	onSaveSuccess: () => void
}

interface UserFormData {
	name: string
	email: string
	password?: string
}

export default function UserEditDrawer({
	visible,
	user,
	onClose,
	onSaveSuccess,
}: UserEditDrawerProps) {
	const { t } = useTranslation()
	const [form] = Form.useForm()
	const [loading, setLoading] = useState(false)
	const isEditing = !!user

	useEffect(() => {
		if (visible) {
			if (user) {
				form.setFieldsValue({
					name: user.name || '',
					email: user.email,
				})
			} else {
				form.resetFields()
			}
		}
	}, [visible, user, form])

	const handleSubmit = async (values: UserFormData) => {
		setLoading(true)
		try {
			const url = isEditing ? `/api/users/${user.id}` : '/api/users'
			const method = isEditing ? 'PUT' : 'POST'

			const response = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(values),
			})

			if (response.ok) {
				message.success(isEditing ? t('admin_users.update_success') : t('admin_users.add_success'))
				onSaveSuccess()
			} else {
				const error = await response.json()
				message.error(error.message || t('common.operation_failed'))
			}
		} catch (error) {
			console.error('Operation error', error)
			message.error(t('common.operation_error'))
		} finally {
			setLoading(false)
		}
	}

	return (
		<Drawer
			title={isEditing ? t('admin_users.edit_user') : t('admin_users.add_user')}
			size={400}
			open={visible}
			onClose={onClose}
			extra={
				<div className="flex justify-end">
					<Space>
						<Button onClick={onClose}>{t('common.cancel')}</Button>
						<Button
							type="primary"
							loading={loading}
							onClick={() => form.submit()}
						>
							{isEditing ? t('common.update') : t('common.add')}
						</Button>
					</Space>
				</div>
			}
		>
			<Form
				form={form}
				layout="vertical"
				onFinish={handleSubmit}
			>
				<Form.Item
					name="name"
					label={t('admin_users.name')}
					rules={[{ required: true, message: t('admin_users.name_required') }]}
				>
					<Input placeholder={t('admin_users.name_placeholder')} />
				</Form.Item>

				<Form.Item
					name="email"
					label={t('auth.email')}
					rules={[
						{ required: true, message: t('admin_users.email_required') },
						{ type: 'email', message: t('auth.email_invalid') },
					]}
				>
					<Input placeholder={t('admin_users.email_placeholder')} />
				</Form.Item>

				{!isEditing && (
					<Form.Item
						name="password"
						label={t('auth.password')}
						rules={[
							{ required: true, message: t('admin_users.password_required') },
							{ min: 6, message: t('admin_users.password_min_6') },
						]}
					>
						<Input.Password placeholder={t('admin_users.password_required')} />
					</Form.Item>
				)}

				{isEditing && (
					<Form.Item
						name="password"
						label={t('auth.new_password')}
						help={t('admin_users.password_keep_hint')}
						rules={[{ min: 6, message: t('admin_users.password_min_6') }]}
					>
						<Input.Password placeholder={t('admin_users.password_keep_hint')} />
					</Form.Item>
				)}
			</Form>
		</Drawer>
	)
}
