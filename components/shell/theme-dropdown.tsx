'use client'

import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { Button, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'

import { ThemeModeEnum, ThemeModeLabelEnum, useThemeContext } from '@/lib/theme'

const icons = {
	[ThemeModeEnum.SYSTEM]: <DesktopOutlined />,
	[ThemeModeEnum.LIGHT]: <SunOutlined />,
	[ThemeModeEnum.DARK]: <MoonOutlined />,
}

export default function ThemeDropdown() {
	const { t } = useTranslation()
	const { themeMode, setThemeMode } = useThemeContext()
	return (
		<Dropdown
			placement="bottomRight"
			menu={{
				selectedKeys: [themeMode],
				items: [
					{
						key: ThemeModeEnum.SYSTEM,
						icon: icons[ThemeModeEnum.SYSTEM],
						label: t(ThemeModeLabelEnum.SYSTEM),
					},
					{
						key: ThemeModeEnum.LIGHT,
						icon: icons[ThemeModeEnum.LIGHT],
						label: t(ThemeModeLabelEnum.LIGHT),
					},
					{
						key: ThemeModeEnum.DARK,
						icon: icons[ThemeModeEnum.DARK],
						label: t(ThemeModeLabelEnum.DARK),
					},
				],
				onClick: ({ key }) => setThemeMode(key as ThemeModeEnum),
			}}
		>
			<Button
				type="text"
				icon={icons[themeMode]}
				aria-label={t('system.theme_mode_system')}
			/>
		</Dropdown>
	)
}
