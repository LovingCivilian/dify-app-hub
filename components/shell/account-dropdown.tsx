'use client'

import { LogoutOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Dropdown, GetProp } from 'antd'
import type { TFunction } from 'i18next'
import { signOut, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

type MenuItems = NonNullable<GetProp<typeof Dropdown, 'menu'>['items']>

interface IAccountMenuItemsOptions {
	email: string
	t: TFunction
	onLogout: () => void
}

/**
 * Menu entries shared by the desktop dropdown and the chat page's mobile menu.
 */
export const getAccountMenuItems = ({
	email,
	t,
	onLogout,
}: IAccountMenuItemsOptions): MenuItems => [
	{
		key: 'account',
		label: t('auth.signed_in_as', { email }),
		disabled: true,
	},
	{
		key: 'logout',
		icon: <LogoutOutlined />,
		label: t('auth.logout'),
		onClick: onLogout,
	},
]

/**
 * Sign out and return to the login page.
 */
export const useLogout = () => {
	const router = useRouter()
	return async () => {
		await signOut({ redirect: false })
		router.push('/login')
	}
}

/**
 * Account dropdown for the shared AppHeader.
 */
export default function AccountDropdown() {
	const { data: session } = useSession()
	const { t } = useTranslation()
	const logout = useLogout()
	const email = session?.user?.email
	if (!email) return null
	return (
		<Dropdown
			trigger={['click']}
			menu={{ items: getAccountMenuItems({ email, t, onLogout: logout }) }}
			placement="bottomRight"
		>
			<Button
				type="text"
				icon={<UserOutlined />}
				aria-label={t('auth.signed_in_as', { email })}
			/>
		</Dropdown>
	)
}
