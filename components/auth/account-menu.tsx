'use client'

import { LogoutOutlined } from '@ant-design/icons'
import { Dropdown, GetProp } from 'antd'
import type { TFunction } from 'i18next'
import { signOut, useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

import LucideIcon from '@/components/shared/lucide-icon'

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
 * Same sign-out flow as the admin header.
 */
export const useLogout = () => {
	const router = useRouter()
	return async () => {
		await signOut({ redirect: false })
		router.push('/login')
	}
}

/**
 * Account dropdown for the chat-side headers.
 */
export default function AccountMenu() {
	const { t } = useTranslation()
	const { data: session } = useSession()
	const logout = useLogout()
	const email = session?.user?.email

	if (!email) return null

	return (
		<Dropdown
			arrow
			placement="bottomRight"
			menu={{ items: getAccountMenuItems({ email, t, onLogout: logout }) }}
		>
			<div className="flex cursor-pointer items-center">
				<LucideIcon
					name="circle-user"
					size={20}
				/>
			</div>
		</Dropdown>
	)
}
