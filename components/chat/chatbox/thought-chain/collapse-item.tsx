import { useTranslation } from 'react-i18next'

interface ICollapseItemProps {
	/**
	 * 需要展示的文本
	 */
	text: string
}

/**
 * 思维链的折叠项
 */
export default function CollapseItem(props: ICollapseItemProps) {
	const { t } = useTranslation()
	const { text } = props
	return text ? (
		<pre className="!bg-theme-bg !m-0 !border-none !p-0">{text}</pre>
	) : (
		t('common.empty')
	)
}
