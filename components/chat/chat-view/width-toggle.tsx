'use client'

import { ColumnWidthOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import { useTranslation } from 'react-i18next'

/** Header control: the message column at its reading width or the full width (spec §5.1). */
export default function WidthToggle({
	wide,
	onChange,
}: {
	wide: boolean
	onChange: (wide: boolean) => void
}) {
	const { t } = useTranslation()
	const label = wide ? t('chat.switch_narrow') : t('chat.switch_wide')
	return (
		<Button
			type="text"
			icon={<ColumnWidthOutlined />}
			aria-label={label}
			title={label}
			onClick={() => onChange(!wide)}
		/>
	)
}
