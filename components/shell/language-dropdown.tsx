'use client'

import { GlobalOutlined } from '@ant-design/icons'
import { Button, Dropdown } from 'antd'
import { useTranslation } from 'react-i18next'

const languages = { en: 'English', zh: '中文', ar: 'العربية' } as const

export default function LanguageDropdown() {
	const { t, i18n } = useTranslation()
	return (
		<Dropdown
			trigger={['click']}
			placement="bottomRight"
			menu={{
				selectedKeys: i18n.resolvedLanguage ? [i18n.resolvedLanguage] : [],
				items: Object.entries(languages).map(([key, label]) => ({ key, label })),
				onClick: ({ key }) => void i18n.changeLanguage(key),
			}}
		>
			<Button
				type="text"
				icon={<GlobalOutlined />}
				aria-label={t('system.language')}
				title={t('system.language')}
			/>
		</Dropdown>
	)
}
