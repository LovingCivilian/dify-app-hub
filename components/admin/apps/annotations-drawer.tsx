'use client'

import { Drawer, Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'

import type { IDifyAppItem } from '@/lib/core'

import AnnotationsPanel from './annotations-panel'

/** The annotations drawer (spec §5.5): the shell only; the panel inside holds the state and is reset per opening. */
export default function AnnotationsDrawer({
	open,
	record,
	onClose,
}: {
	open: boolean
	record?: IDifyAppItem
	onClose: () => void
}) {
	const { t } = useTranslation()

	return (
		<Drawer
			open={open}
			onClose={onClose}
			size="large"
			destroyOnHidden
			title={t('admin_apps.annotations')}
		>
			{record ? (
				<AnnotationsPanel
					key={record.id}
					record={record}
				/>
			) : (
				<Skeleton
					active
					paragraph={{ rows: 6 }}
				/>
			)}
		</Drawer>
	)
}
