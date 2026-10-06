'use client'

import { EllipsisOutlined } from '@ant-design/icons'
import { App, Button, Dropdown, type MenuProps } from 'antd'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'

import { deleteApp, getApp, updateApp } from '@/app/(admin)/app-management/actions'
import { DifyApi } from '@/lib/api'

import type { AdminAppRow } from './admin-app-row'
import { isAppInfo, isFailedUpdate } from './app-record'

/** A row's actions (spec §5.3). Every outcome is a translated message; success refreshes the server page. */
export default function AppActions({ app }: { app: AdminAppRow }) {
	const { t } = useTranslation()
	const { message, modal } = App.useApp()
	const router = useRouter()

	const sync = async () => {
		try {
			const record = await getApp(app.id)
			if (!record) {
				message.error(t('admin_apps.not_found'))
				return
			}
			const info = await new DifyApi({ ...record.requestConfig, user: '' }).getAppInfo()
			if (!isAppInfo(info)) throw new Error('Dify answered without app info')
			const { info: current, ...rest } = record
			if (isFailedUpdate(await updateApp({ ...rest, info: { ...current, ...info } }))) {
				throw new Error('updateApp failed')
			}
			message.success(t('admin_apps.sync_success'))
			router.refresh()
		} catch (error) {
			console.error('Failed to sync app info', error)
			message.error(t('admin_apps.sync_failed'))
		}
	}

	const confirmDelete = () =>
		modal.confirm({
			title: t('admin_apps.delete_confirm_title'),
			content: t('admin_apps.delete_confirm_description'),
			okText: t('common.delete'),
			okButtonProps: { danger: true },
			cancelText: t('common.cancel'),
			// The dialog stays open with a loading OK button until this settles (Modal hooks, onOk).
			onOk: async () => {
				try {
					await deleteApp(app.id)
					message.success(t('admin_apps.delete_success'))
					router.refresh()
				} catch (error) {
					console.error('Failed to delete app', error)
					message.error(t('common.delete_failed'))
				}
			},
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
		{ type: 'divider' },
		{ key: 'delete', label: t('common.delete'), danger: true },
	]
	const onClick: MenuProps['onClick'] = ({ key }) => {
		if (key === 'sync') void sync()
		if (key === 'delete') confirmDelete()
	}

	return (
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
	)
}
