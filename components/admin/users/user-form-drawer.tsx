'use client'

import { App, Button, Descriptions, Drawer, Form, Input, Radio, Space, Typography } from 'antd'
import { useTranslation } from 'react-i18next'

import {
	createUserAction,
	updateUserAction,
	updateUserRoleAction,
} from '@/app/(admin)/user-management/actions'
import type { UserFormInput } from '@/app/(admin)/user-management/schemas'
import { useActionTransition } from '@/hooks/use-action-transition'
import { emailRule, nameRule, PASSWORD_MIN, passwordBytesRule } from '@/lib/auth/fields'
import { MANAGEABLE_ROLES, type Role } from '@/lib/auth/roles'
import type { UserDto } from '@/lib/data/users'

import { ROLE_LABEL_KEYS } from './role-labels'
import { userErrorKey } from './user-errors'

const USER_FORM_ID = 'user-form'

/**
 * A directory account's edit (decision an): the name, email and directory username read-only, since the directory
 * overwrites them, and the role under the rank map; no password (spec §6.3).
 */
function DirectoryUserForm({
	user,
	roleOptions,
	onSave,
}: {
	user: UserDto
	roleOptions: readonly Role[]
	onSave: (values: { role: Role }) => void
}) {
	const { t } = useTranslation()
	return (
		<Form<{ role: Role }>
			id={USER_FORM_ID}
			layout="vertical"
			initialValues={{ role: user.role }}
			onFinish={onSave}
		>
			<Descriptions
				column={1}
				size="small"
				items={[
					{
						key: 'name',
						label: t('admin_users.name'),
						children: user.name || t('admin_users.name_not_set'),
					},
					{ key: 'email', label: t('auth.email'), children: user.email },
					{
						key: 'username',
						label: t('admin_users.directory_username'),
						children: user.directoryUsername ?? '',
					},
				]}
			/>
			<Typography.Paragraph type="secondary">
				{t('admin_users.directory_fields_hint')}
			</Typography.Paragraph>
			<Form.Item
				name="role"
				label={t('admin_users.role')}
				extra={roleOptions.length < 2 ? t('admin_users.role_owner_only_hint') : undefined}
			>
				<Radio.Group
					optionType="button"
					disabled={roleOptions.length < 2}
					options={roleOptions.map(role => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
				/>
			</Form.Item>
		</Form>
	)
}

/**
 * Add or edit a user (charter §4.2). The Server Actions run through startTransition from onFinish (ADR-0023
 * "Admin actions"; the Form owns validation), and each refreshes the page itself.
 *
 * Your own row has no password field and a fixed role: your own password changes from the account menu with the
 * current one, only the owner changes an admin's role, and the owner's never changes (ADR-0024). Elsewhere the
 * role options are the roles the signed-in account's rank may give (MANAGEABLE_ROLES): Admin and User for the
 * owner, User alone for an admin, shown disabled with a hint. The server applies the same rank. A disabled field
 * keeps its value in the form store, so the role is still submitted (antd's store has no notion of disabled).
 *
 * The Form owns its instance (antd creates one when `form` is not provided), so each mounting under
 * `destroyOnHidden` gets a fresh store seeded from its own `initialValues`. A drawer-level `Form.useForm()` would
 * keep the previous user's values, and `clearOnDestroy` empties the store under Strict Mode's remount. The Form is
 * keyed by the user it edits, so a drawer reopened for someone else while it still slides out gets a fresh store
 * too. The submit button in `extra` reaches the form through the HTML `form` attribute.
 *
 * A directory account gets DirectoryUserForm instead, with the same form id: its role only (decision an).
 */
export default function UserFormDrawer({
	open,
	user,
	currentUser,
	onClose,
	onClosed,
}: {
	open: boolean
	/** The user to edit; absent when adding. */
	user?: UserDto
	/** The signed-in account: its own row offers no password field and a fixed role; its role decides the options. */
	currentUser: { id: string; role: Role }
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears `user`. */
	onClosed: () => void
}) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const { pending, run } = useActionTransition()
	const isSelf = user?.id === currentUser.id
	// Your own role is fixed; otherwise the roles the signed-in account's rank may give (ADR-0024).
	const roleOptions: readonly Role[] =
		user && user.id === currentUser.id ? [user.role] : MANAGEABLE_ROLES[currentUser.role]

	const save = (values: UserFormInput) =>
		void run(async () => {
			if (user) {
				const result = await updateUserAction(user.id, values)
				if (!result.ok) {
					message.error(t(userErrorKey(result.code)))
					return
				}
				message.success(t('admin_users.update_success'))
				onClose()
				return
			}
			const result = await createUserAction(values)
			if (!result.ok) {
				message.error(t(userErrorKey(result.code)))
				return
			}
			message.success(t('admin_users.add_success'))
			onClose()
		})

	const saveRole = (values: { role: Role }) =>
		void run(async () => {
			if (!user) return
			const result = await updateUserRoleAction(user.id, values)
			if (!result.ok) {
				message.error(t(userErrorKey(result.code)))
				return
			}
			message.success(t('admin_users.update_success'))
			onClose()
		})

	return (
		<Drawer
			open={open}
			onClose={onClose}
			afterOpenChange={visible => {
				if (!visible) onClosed()
			}}
			destroyOnHidden
			title={
				user?.source === 'ldap'
					? t('admin_users.directory_account')
					: user
						? t('admin_users.edit_user')
						: t('admin_users.add_user')
			}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						htmlType="submit"
						form={USER_FORM_ID}
						loading={pending}
					>
						{user ? t('common.update') : t('common.add')}
					</Button>
				</Space>
			}
		>
			{user?.source === 'ldap' ? (
				<DirectoryUserForm
					key={user.id}
					user={user}
					roleOptions={roleOptions}
					onSave={saveRole}
				/>
			) : (
				<Form<UserFormInput>
					key={user?.id ?? 'create'}
					id={USER_FORM_ID}
					layout="vertical"
					initialValues={
						user ? { name: user.name ?? '', email: user.email, role: user.role } : { role: 'user' }
					}
					onFinish={save}
				>
					<Form.Item
						name="name"
						label={t('admin_users.name')}
						rules={[
							{ required: true, whitespace: true, message: t('admin_users.name_required') },
							nameRule(t('admin_users.name_too_long')),
						]}
					>
						<Input placeholder={t('admin_users.name_placeholder')} />
					</Form.Item>
					<Form.Item
						name="email"
						label={t('auth.email')}
						rules={[
							{ required: true, message: t('admin_users.email_required') },
							emailRule(t('auth.email_invalid')),
						]}
					>
						<Input placeholder={t('admin_users.email_placeholder')} />
					</Form.Item>
					<Form.Item
						name="role"
						label={t('admin_users.role')}
						extra={
							isSelf
								? t('admin_users.role_self_hint')
								: roleOptions.length < 2
									? t('admin_users.role_owner_only_hint')
									: undefined
						}
					>
						<Radio.Group
							optionType="button"
							disabled={roleOptions.length < 2}
							options={roleOptions.map(role => ({ value: role, label: t(ROLE_LABEL_KEYS[role]) }))}
						/>
					</Form.Item>
					{isSelf ? (
						<Typography.Paragraph type="secondary">
							{t('admin_users.password_self_hint')}
						</Typography.Paragraph>
					) : (
						<Form.Item
							name="password"
							label={user ? t('auth.new_password') : t('auth.password')}
							extra={user ? t('admin_users.password_keep_hint') : undefined}
							rules={[
								...(user ? [] : [{ required: true, message: t('admin_users.password_required') }]),
								{ min: PASSWORD_MIN, message: t('auth.password_min_8') },
								passwordBytesRule(t('auth.password_too_long')),
							]}
						>
							<Input.Password autoComplete="new-password" />
						</Form.Item>
					)}
				</Form>
			)}
		</Drawer>
	)
}
