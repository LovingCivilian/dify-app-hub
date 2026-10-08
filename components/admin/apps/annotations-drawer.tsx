'use client'

import { Drawer } from 'antd'
import { useTranslation } from 'react-i18next'

import AnnotationsPanel from './annotations-panel'

/** The annotations drawer (spec §5.5): the shell only; the panel inside holds the state and is reset per opening. */
export default function AnnotationsDrawer({
	open,
	appId,
	onClose,
	onClosed,
}: {
	open: boolean
	appId?: string
	onClose: () => void
	/** Called once the close animation has ended (Drawer `afterOpenChange(false)`): the parent clears the app id. */
	onClosed: () => void
}) {
	const { t } = useTranslation()

	return (
		<Drawer
			open={open}
			onClose={onClose}
			afterOpenChange={visible => {
				if (!visible) onClosed()
			}}
			size="large"
			destroyOnHidden
			title={t('admin_apps.annotations')}
		>
			{appId && (
				<AnnotationsPanel
					key={appId}
					appId={appId}
				/>
			)}
		</Drawer>
	)
}
