'use client'

import { KeyOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Dropdown, GetProp } from 'antd'
import type { TFunction } from 'i18next'
import { useSession } from 'next-auth/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import ChangePasswordModal from './change-password-modal'
import { logout } from './sign-out'

type MenuItems = NonNullable<GetProp<typeof Dropdown, 'menu'>['items']>

interface IAccountMenuItemsOptions {
	email: string
	t: TFunction
	onChangePassword: () => void
	onLogout: () => void
}

/**
 * Menu entries shared by the desktop dropdown and the chat page's mobile menu.
 */
export const getAccountMenuItems = ({
	email,
	t,
	onChangePassword,
	onLogout,
}: IAccountMenuItemsOptions): MenuItems => [
	{
		key: 'account',
		label: t('auth.signed_in_as', { email }),
		disabled: true,
	},
	{
		key: 'change-password',
		icon: <KeyOutlined />,
		label: t('account.change_password'),
		onClick: onChangePassword,
	},
	{
		key: 'logout',
		icon: <LogoutOutlined />,
		label: t('auth.logout'),
		onClick: onLogout,
	},
]

/**
 * Account dropdown for the shared AppHeader.
 */
export default function AccountDropdown() {
	const { data: session } = useSession()
	const { t } = useTranslation()
	const [changingPassword, setChangingPassword] = useState(false)
	const email = session?.user?.email
	if (!email) return null
	return (
		<>
			<Dropdown
				trigger={['click']}
				menu={{
					items: getAccountMenuItems({
						email,
						t,
						onChangePassword: () => setChangingPassword(true),
						onLogout: logout,
					}),
				}}
				placement="bottomRight"
			>
				<Button
					type="text"
					icon={<UserOutlined />}
					aria-label={t('auth.signed_in_as', { email })}
					title={t('auth.signed_in_as', { email })}
				/>
			</Dropdown>
			<ChangePasswordModal
				open={changingPassword}
				onClose={() => setChangingPassword(false)}
			/>
		</>
	)
}
