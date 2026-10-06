'use client'

import { App, Button, Drawer, Form, Skeleton, Space } from 'antd'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createApp, updateApp } from '@/app/(admin)/app-management/actions'
import { DifyApi } from '@/lib/api'
import type { IDifyAppItem } from '@/lib/core'

import {
	type AppFormValues,
	DEFAULT_APP_FORM_VALUES,
	fromAppFormValues,
	toAppFormValues,
} from './app-form-values'
import { isAppInfo, isFailedUpdate } from './app-record'
import AppSettingsFields from './app-settings-fields'

const APP_FORM_ID = 'app-settings-form'

export interface AppFormDrawerProps {
	open: boolean
	/** 'edit' shows a skeleton until `record` arrives (getApp, spec §5.4). */
	mode: 'create' | 'edit'
	record?: IDifyAppItem
	onClose: () => void
}

/**
 * Create or edit an app (spec §5.4): antd's form-in-drawer layout with the actions in `extra`; `destroyOnHidden`
 * unmounts the form on close. The Form owns its instance (no `form` prop), so each mounting gets a fresh store
 * seeded from its own `initialValues`; a drawer-level `Form.useForm()` would keep the last values (and
 * `clearOnDestroy` empties the store under Strict Mode's remount). The submit button reaches the form through
 * the HTML `form` attribute.
 */
export default function AppFormDrawer({ open, mode, record, onClose }: AppFormDrawerProps) {
	const { t } = useTranslation()
	const { message } = App.useApp()
	const router = useRouter()
	const [saving, setSaving] = useState(false)
	const loading = mode === 'edit' && !record

	const save = async (values: AppFormValues) => {
		setSaving(true)
		try {
			// The browser asks Dify with the entered base and key, as before; a refused key, an error body or an
			// unreachable base keeps the drawer open (Review Focus 1).
			const info = await new DifyApi({
				user: '',
				apiBase: values.requestConfig.apiBase,
				apiKey: values.requestConfig.apiKey,
			})
				.getAppInfo()
				.catch(() => undefined)
			if (!isAppInfo(info)) {
				message.error(t('admin_apps.dify_unreachable'))
				return
			}
			const item = fromAppFormValues(values, info)
			if (record) {
				if (isFailedUpdate(await updateApp({ id: record.id, ...item }))) {
					throw new Error('updateApp failed')
				}
				message.success(t('admin_apps.edit_success'))
			} else {
				await createApp(item)
				message.success(t('admin_apps.create_success'))
			}
			onClose()
			router.refresh()
		} catch (error) {
			console.error('Failed to save the app', error)
			message.error(t('admin_apps.save_failed'))
		} finally {
			setSaving(false)
		}
	}

	return (
		<Drawer
			open={open}
			onClose={onClose}
			size="large"
			destroyOnHidden
			title={
				mode === 'edit'
					? t('admin_apps.edit_title', { name: record?.info.name ?? '' })
					: t('admin_apps.create_title')
			}
			extra={
				<Space>
					<Button onClick={onClose}>{t('common.cancel')}</Button>
					<Button
						type="primary"
						loading={saving}
						disabled={loading}
						htmlType="submit"
						form={APP_FORM_ID}
					>
						{mode === 'edit' ? t('common.update') : t('common.ok')}
					</Button>
				</Space>
			}
		>
			{loading ? (
				<Skeleton
					active
					paragraph={{ rows: 10 }}
				/>
			) : (
				<Form
					id={APP_FORM_ID}
					layout="vertical"
					autoComplete="off"
					initialValues={record ? toAppFormValues(record) : DEFAULT_APP_FORM_VALUES}
					onFinish={save}
				>
					<AppSettingsFields record={record} />
				</Form>
			)}
		</Drawer>
	)
}
