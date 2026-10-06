'use client'

import { App, Button, Drawer, Form, Input, Space } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { userErrorKey } from './user-errors'
import type { UserRow } from './user-row'

const PASSWORD_MIN = 8
const USER_FORM_ID = 'user-form'

interface UserFormValues {
	name: string
	email: string
	password?: string
}

/**
 * Add or edit a user (spec §6): /api/users keeps its contract; 8-character minimum everywhere (owner decision).
 * The Form owns its instance (antd creates one automatically when `form` is not provided), so each mounting under
 * `destroyOnHidden` gets a fresh store seeded from its own `initialValues`; a drawer-level `Form.useForm()` would
 * keep the previous user's values (and `clearOnDestroy` empties the store under Strict Mode's remount). The
 * submit button in `extra` reaches the form through the HTML `form` attribute; antd spreads `id` onto `<form>`.
 * The Form is keyed by the user it edits, so a drawer reopened for someone else while it still slides out (no
 * unmount in between) gets a fresh store too.
 */
export default function UserFormDrawer({
	open,
	user,
	onClose,
	onClosed,
}: {
	open: boolean
	/** The user to edit; absent when adding. */
	user?: UserRow
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears `user`. */
	onClosed: () => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [saving, setSaving] = useState(false)

	const save = async (values: UserFormValues) => {
		setSaving(true)
		try {
			const response = await fetch(user ? `/api/users/${user.id}` : '/api/users', {
				method: user ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(values),
			})
			if (!response.ok) {
				message.error(t(userErrorKey(response.status, user ? 'update' : 'create')))
				return
			}
			message.success(user ? t('admin_users.update_success') : t('admin_users.add_success'))
			onClose()
			router.refresh()
		} catch (error) {
			console.error('Failed to save the user', error)
			message.error(t('common.operation_error'))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Drawer
			open={open}
			onClose={onClose}
			afterOpenChange={visible => {
				if (!visible) onClosed()
			}}
			destroyOnHidden
			title={user ? t('admin_users.edit_user') : t('admin_users.add_user')}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						htmlType="submit"
						form={USER_FORM_ID}
						loading={saving}
					>
						{user ? t('common.update') : t('common.add')}
					</Button>
				</Space>
			}
		>
			<Form
				key={user?.id ?? 'create'}
				id={USER_FORM_ID}
				layout="vertical"
				initialValues={user ? { name: user.name ?? '', email: user.email } : undefined}
				onFinish={save}
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
				<Form.Item
					name="password"
					label={user ? t('auth.new_password') : t('auth.password')}
					extra={user ? t('admin_users.password_keep_hint') : undefined}
					rules={[
						...(user ? [] : [{ required: true, message: t('admin_users.password_required') }]),
						{ min: PASSWORD_MIN, message: t('auth.password_min_8') },
					]}
				>
					<Input.Password autoComplete="new-password" />
				</Form.Item>
			</Form>
		</Drawer>
	)
}
