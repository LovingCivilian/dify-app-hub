'use client'

import { EllipsisOutlined } from '@ant-design/icons'
import { App, Button, Dropdown, Flex, type MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { deleteAppAction, syncAppAction } from '@/app/(admin)/app-management/actions'
import { useActionTransition } from '@/hooks/use-action-transition'

import type { AdminAppRow } from './admin-app-row'
import { appErrorKey } from './app-errors'

/** A row's actions (spec §5.3). Every outcome is a translated message; the actions refresh the server page. */
export default function AppActions({
	app,
	onEdit,
	onAnnotations,
}: {
	app: AdminAppRow
	onEdit: () => void
	onAnnotations?: () => void
}) {
	const { t } = useTranslation()
	const { message, modal } = App.useApp()
	const { run } = useActionTransition()

	const sync = () =>
		void run(async () => {
			const result = await syncAppAction(app.id)
			if (!result.ok) {
				message.error(t(appErrorKey(result.code, 'sync')))
				return
			}
			message.success(t('admin_apps.sync_success'))
			if (result.data.partial) message.warning(t('admin_apps.icon_not_stored'))
		})

	const confirmDelete = () =>
		modal.confirm({
			title: t('admin_apps.delete_confirm_title'),
			content: t('admin_apps.delete_confirm_description'),
			okText: t('common.delete'),
			okButtonProps: { danger: true },
			cancelText: t('common.cancel'),
			// The dialog stays open with a loading OK button until the transition settles (Modal hooks, onOk).
			onOk: () =>
				run(async () => {
					const result = await deleteAppAction(app.id)
					if (result.ok) message.success(t('admin_apps.delete_success'))
					else message.error(t(appErrorKey(result.code, 'delete')))
				}),
		})

	const items: MenuProps['items'] = [
		{
			key: 'view',
			label: (
				<a
					href={`/chat/${app.id}`}
					target="_blank"
					rel="noreferrer"
				>
					{t('admin_apps.user_view')}
				</a>
			),
		},
		{ key: 'sync', label: t('admin_apps.sync_info') },
		...(onAnnotations ? [{ key: 'annotations', label: t('admin_apps.annotations') }] : []),
		{ type: 'divider' },
		{ key: 'delete', label: t('common.delete'), danger: true },
	]
	const onClick: MenuProps['onClick'] = ({ key }) => {
		if (key === 'sync') sync()
		if (key === 'annotations') onAnnotations?.()
		if (key === 'delete') confirmDelete()
	}

	return (
		<Flex
			align="center"
			gap="small"
		>
			<Button
				type="link"
				onClick={onEdit}
			>
				{t('common.edit')}
			</Button>
			<Dropdown
				trigger={['click']}
				menu={{ items, onClick }}
			>
				<Button
					type="text"
					icon={<EllipsisOutlined />}
					aria-label={t('admin_apps.more_actions')}
					title={t('admin_apps.more_actions')}
				/>
			</Dropdown>
		</Flex>
	)
}
