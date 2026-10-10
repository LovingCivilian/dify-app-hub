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
	/** Absent for a directory account, which has no hub password (decision v): the entry is left out. */
	onChangePassword?: () => void
	onLogout: () => void
}

/**
 * The account dropdown's menu entries (`AccountDropdown` below is the only caller), exported for the unit test.
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
	...(onChangePassword
		? [
				{
					key: 'change-password',
					icon: <KeyOutlined />,
					label: t('account.change_password'),
					onClick: onChangePassword,
				},
			]
		: []),
	{
		key: 'logout',
		icon: <LogoutOutlined />,
		label: t('auth.logout'),
		onClick: onLogout,
	},
]

/**
 * Account dropdown for the shared AppHeader. A directory account has no hub password, so it gets neither the
 * "Change password" entry nor its modal (decision v).
 */
export default function AccountDropdown() {
	const { data: session } = useSession()
	const { t } = useTranslation()
	const [changingPassword, setChangingPassword] = useState(false)
	const email = session?.user?.email
	if (!email) return null
	const hasHubPassword = session?.user?.source !== 'ldap'
	return (
		<>
			<Dropdown
				trigger={['click']}
				menu={{
					items: getAccountMenuItems({
						email,
						t,
						onChangePassword: hasHubPassword ? () => setChangingPassword(true) : undefined,
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
			{hasHubPassword && (
				<ChangePasswordModal
					open={changingPassword}
					onClose={() => setChangingPassword(false)}
				/>
			)}
		</>
	)
}
