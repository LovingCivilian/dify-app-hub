import { Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'
import { useThemeContext } from './theme-context'
import { ThemeModeEnum, ThemeModeLabelEnum } from './constants'
import { DynamicIcon } from 'lucide-react/dynamic'

interface IThemeSelectorProps {
	children?: React.ReactNode
}

/**
 * 主题选择器组件
 */
export default function ThemeSelector(props: IThemeSelectorProps) {
	const { t } = useTranslation()
	const { children } = props
	const { themeMode, setThemeMode } = useThemeContext()

	return (
		<Dropdown
			placement="bottomRight"
			menu={{
				selectedKeys: [themeMode],
				items: [
					{
						type: 'item',
						key: ThemeModeEnum.SYSTEM,
						label: t(ThemeModeLabelEnum.SYSTEM),
						icon: <DynamicIcon name="screen-share" />,
					},
					{
						type: 'item',
						key: ThemeModeEnum.LIGHT,
						label: t(ThemeModeLabelEnum.LIGHT),
						icon: <DynamicIcon name="sun" />,
					},
					{
						type: 'item',
						key: ThemeModeEnum.DARK,
						label: t(ThemeModeLabelEnum.DARK),
						icon: <DynamicIcon name="moon-star" />,
					},
				],
				onClick: item => {
					setThemeMode(item.key as ThemeModeEnum)
				},
			}}
		>
			{children}
		</Dropdown>
	)
}
