'use client'

import { EllipsisOutlined } from '@ant-design/icons'
import { App, Button, Dropdown, Flex, type MenuProps } from 'antd'
import { useTranslation } from 'react-i18next'

import { deleteAppAction } from '@/app/(admin)/app-management/actions'
import { useActionTransition } from '@/hooks/use-action-transition'

import type { AdminAppRow } from './admin-app-row'
import { appErrorKey } from './app-errors'

/** A row's actions (spec §5.3). Every outcome is a translated message; the actions refresh the server page. */
export default function AppActions({ app, onEdit }: { app: AdminAppRow; onEdit: () => void }) {
	const { t } = useTranslation()
	const { message, modal } = App.useApp()
	const { run } = useActionTransition()

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
		{ type: 'divider' },
		{ key: 'delete', label: t('common.delete'), danger: true },
	]
	const onClick: MenuProps['onClick'] = ({ key }) => {
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
