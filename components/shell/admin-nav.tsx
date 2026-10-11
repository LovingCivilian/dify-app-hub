import { AppstoreOutlined, SettingOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import Link from 'next/link'

/**
 * The admin sidebar's two groups (settings spec §5.1), as antd Layout's "Sider" demo builds them: an inline Menu whose
 * items carry `children`. Groups carry the icons; children are pages, without icons. The page titles keep their own keys
 * (admin.menu_apps, …), so the children have shorter labels of their own.
 */
export const ADMIN_NAV = [
	{
		key: 'management',
		icon: <AppstoreOutlined />,
		label: 'admin.menu_management',
		children: [
			{ key: '/app-management', label: 'admin.menu_item_apps' },
			{ key: '/user-management', label: 'admin.menu_item_users' },
			{ key: '/group-management', label: 'admin.menu_item_groups' },
		],
	},
	{
		key: 'settings',
		icon: <SettingOutlined />,
		label: 'admin.menu_settings',
		children: [{ key: '/settings/branding', label: 'admin.menu_item_branding' }],
	},
] as const

type AdminNavGroup = (typeof ADMIN_NAV)[number]
type AdminNavPage = AdminNavGroup['children'][number]
export type AdminNavLabel = AdminNavGroup['label'] | AdminNavPage['label']

/** Both groups start open (spec §5.1; antd Menu `defaultOpenKeys`). */
export const ADMIN_NAV_OPEN_KEYS: string[] = ADMIN_NAV.map(group => group.key)

export const adminNavItems = (t: (key: AdminNavLabel) => string): NonNullable<MenuProps['items']> =>
	ADMIN_NAV.map(group => ({
		key: group.key,
		icon: group.icon,
		label: t(group.label),
		children: group.children.map(item => ({
			key: item.key,
			label: <Link href={item.key}>{t(item.label)}</Link>,
		})),
	}))

/**
 * The page under the pathname: the child whose path is the pathname or its prefix at a segment boundary. The flatMap
 * callback's return type is spelled out: over the `as const` tuple, TypeScript would infer it from the first group's
 * children alone and reject the second group's.
 */
export const selectedAdminKey = (pathname: string): string | undefined =>
	ADMIN_NAV.flatMap((group): readonly AdminNavPage[] => group.children).find(
		item => pathname === item.key || pathname.startsWith(`${item.key}/`),
	)?.key
